package com.zbb.automation.v4

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.regex.Pattern

/**
 * 日志上传 Worker —— W5: F4 + F2 + F3 完整方案 (2026-07-21 老板拍板)
 *
 * 历史背景:
 *   - v1.6.4.1-huawei-hotfix-fix-A+B+C (2026-07-05 12:08 拍板): byte offset 游标 + heartbeat meta
 *   - 但 MAX_LOG_CHARS=64K 截断导致首次大上传(155K chars)丢 90K chars + offset 一次性 commit
 *
 * W5 三层修复:
 *   - F4 救历史: detect prevOffset==currentSize>MAX_LOG_CHARS 自动重置 offset 到 MAX_LOG_CHARS,
 *               下次 tick 重传截断区间(90K chars)。用户零操作,装完 APK 后首次 tick 自动触发
 *   - F2 按行切: chunk 边界对齐到行尾(\\n),避免 UTF-8 surrogate pair 乱码 + 半截行
 *   - F3 分片上传: fullPayload → List<Chunk> → 每个 chunk 带 seq/total_seq/terminal 字段
 *                 server 按 client_ts_ms+source 累积,terminal 触发最终落盘。
 *                 client 等 server ack 才 commit offset;chunk 失败 retry 整个 chunk
 *
 * 链路: Phone App → 公网 HTTPS → Tailscale DERP → WSL tailscaled funnel → Win FW → python → D:\落盘
 */
class LogUploadWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

    companion object {
        private const val TAG = "LogUploadWorker"

        // Tailscale Funnel HTTPS 永久 MagicDNS
        private const val UPLOAD_URL = "https://desktop-hi4ajgj.taildab2db.ts.net/log"
        // 2026-07-21 W5 F5: 客户端健康检查 — 同一 host 不同 path
        private const val SERVER_BASE_URL = "https://desktop-hi4ajgj.taildab2db.ts.net"

        // 单 chunk 上限 (chars) — F3 分片后,这个值同时是 chunk 大小上限
        private const val MAX_LOG_CHARS = 64 * 1024

        // F3: 单 chunk 最大重试次数
        private const val MAX_CHUNK_RETRIES = 3

        private const val LOGCAT_LINES = 500

        // SharedPreferences 持久化 offset state
        private const val PREFS_NAME = "zbb_log_upload_state"

        private val PHONE = Pattern.compile("\\b1[3-9]\\d{9}\\b")
        private val EMAIL = Pattern.compile("\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}\\b")
        private val ID_CARD = Pattern.compile("\\b[1-9]\\d{16}[\\dXx]\\b")

        /**
         * 计算单文件的 next offset (v19.49 D1: 删 F4 救历史 reset 逻辑)
         *
         * 历史:
         *   v19.38 截断后 commit offset 错位 → 90K chars 永久丢失
         *   v19.40 W5 加 F4 救历史: prev==curr>MAX_LOG_CHARS 时 reset to 64K
         *     → 但 W5 commit 时机修好后, prev==curr 在每次 tick 没新内容时都满足
         *     → 无限循环重传 [64K, currentSize], server 已有这段 → 重复浪费
         *   v19.45 F5 verify 兜底 commit 错位: client > server → rollback client offset = server offset
         *   v19.49 D1 (07-22 老板拍板): 删 F4 救历史, 只保留 rotate 检测
         *     → F5 + W5 commit 时机 已经覆盖所有 commit 错位场景
         *     → F4 仅防 truncate/rotate 后 prev > curr 导致永远 skip
         *
         * 新逻辑:
         *   - 文件变小 (rotate/truncate) → reset 0
         *   - 其他场景 → return prevOffset (不重置)
         */
        fun computeNextOffset(prevOffset: Long, currentSize: Long): Long {
            if (currentSize < prevOffset) return 0L
            return prevOffset
        }
    }

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        try {
            // 🆕 v19.61 (07-22) 老板拍板:
            //   - LogUploadWorker 移除 isQuietHour 闸门（log 是基础设施, 24h 上传）
            //   - 闸门统一在 ZbbKeepAliveService.tick 入口（业务中心）
            //   - 静默期 ZbbKeepAliveService.tick 跳过, 不会排 LogUploadScheduler.scheduleNextForTest(0),
            //     所以 LogUploadWorker 不会被触发, 链路自然断（07:00 第一个 tick 自然续上）
            // 历史:
            //   v19.46 错位: 把 isQuietHour 接进 Worker, 但漏了 WorkOrchestrator.startIdleWork() 入口,
            //                导致 22:00 业务层还在跑（被老板抓到）

            // 2026-07-21 W5 F5: doWork 开头先做客户端健康检查
            // 调 server /log-offset 拿每文件 last_offset,对比 SharedPreferences
            // client > server → rollback (v19.39/W4 真凶场景)
            // verify 失败 → 跳过,正常走 F1-F4 (下次 tick 再 verify)
            verifyOffsetsWithServer()

            val (heartbeatText, heartbeatObj) = collectHeartbeat()
            val newContent = collectNewContentFromFilesDir()
            val isNewData = newContent.isNotBlank()

            // 2026-07-21 W5 F5: heartbeat 附加 pending_offsets (key=业务文件名, value=commit 后 byte offset)
            // server 端根据这个字段在 terminal chunk 合并成功后更新 last_offset
            // 注意: 这里用的是 commit 前的 currentSize,实际 commit 在所有 chunk 成功后
            if (pendingOffsets != null && pendingOffsets!!.isNotEmpty()) {
                val po = JSONObject()
                for ((k, v) in pendingOffsets!!) {
                    po.put(k, v)
                }
                heartbeatObj.put("pending_offsets", po)
                Log.d(TAG, "F5 heartbeat.pending_offsets=$po")
            }

            val fullPayload = buildString {
                append("=== heartbeat (log_upload_worker tick) ===\n")
                append(heartbeatText)
                if (isNewData) {
                    append("\n\n=== new business logs (incremental, from offset state) ===\n")
                    append(newContent)
                }
            }
            if (fullPayload.isBlank()) {
                Log.w(TAG, "empty payload, skip upload")
                LogUploadScheduler.scheduleNext(applicationContext)
                return@withContext Result.success()
            }

            val sanitized = sanitize(fullPayload)
            // F2: 按行边界切 chunk (替代 v19.38 之前的 MAX_LOG_CHARS 硬切)
            val chunks = splitByLineBoundary(sanitized, MAX_LOG_CHARS)
            // F3: 整个 tick 共用同一 clientTs,server 端累积成同一次上传
            val clientTs = System.currentTimeMillis()

            Log.d(TAG, "W5 upload: raw=${fullPayload.length} chars → sanitized=${sanitized.length} chars → ${chunks.size} chunks, is_new_data=$isNewData")

            // F3: 分片上传,每个 chunk 等 server ack 才算成功。
            // 🆕 D1 A v3 (07-23 老板拍板 A+B):
            //   transport chunk 字节包含 heartbeat/分隔头/脱敏后文本，不能直接当业务文件 byte offset。
            //   只有全部 chunk 成功后，才能把业务文件 offset 精确提交到采集时的 currentSize。
            var allOk = true
            for ((idx, chunk) in chunks.withIndex()) {
                var attempt = 0
                var ok = false
                while (attempt < MAX_CHUNK_RETRIES && !ok) {
                    attempt++
                    ok = uploadChunk(
                        chunk = chunk,
                        seq = idx,
                        totalSeq = chunks.size,
                        heartbeatObj = heartbeatObj,
                        isNewData = isNewData,
                        clientTs = clientTs
                    )
                    if (!ok) Log.w(TAG, "chunk $idx/${chunks.size} attempt $attempt failed")
                }
                if (!ok) {
                    Log.e(TAG, "chunk $idx/${chunks.size} failed after $MAX_CHUNK_RETRIES attempts; offsets NOT committed (D1 A v3 safe mode)")
                    allOk = false
                    break
                }
                Log.d(TAG, "chunk $idx/${chunks.size} uploaded OK")
            }

            // 🆕 D1 A v3 根因修复：旧代码只在单 chunk 成功时整体 commit。
            // 多 chunk 即使全部成功，也不会提交 pendingOffsets，所以下次 tick 永远从旧 offset 重读。
            if (allOk && isNewData) {
                commitUploadOffsets()
            }

            if (allOk) {
                LogUploadScheduler.scheduleNext(applicationContext)
                Result.success()
            } else {
                // 失败时不提交 offset，避免把 transport 字节错当业务文件字节造成日志永久丢失。
                // server 端 force-merge/dedup 负责处理已收到的残片；下个 tick 安全重试。
                Log.w(TAG, "partial upload: chunks=${chunks.size}, offsets kept unchanged, schedule next tick (D1 A v3)")
                LogUploadScheduler.scheduleNext(applicationContext)
                Result.success()
            }
        } catch (e: Exception) {
            Log.e(TAG, "upload error: ${e.message}", e)
            Result.retry()
        }
    }

    /**
     * F2: 按行边界切分文本
     * - 找到 chunk 边界处的最后一个 \n,保证 chunk 边界对齐到行尾
     * - 减少 UTF-8 surrogate pair 被切在中间产生乱码的风险(虽然无法完全避免,但远好于 char 切)
     * - 避免半截行(每个 chunk 内都是完整行,最后一个 chunk 可能末尾缺 \n 但 server 端累积会处理)
     */
    private fun splitByLineBoundary(text: String, maxChars: Int): List<String> {
        if (text.length <= maxChars) return listOf(text)
        val chunks = mutableListOf<String>()
        var start = 0
        while (start < text.length) {
            var end = (start + maxChars).coerceAtMost(text.length)
            if (end < text.length) {
                // 找 [start, end) 区间内最后一个 \n
                val lastNewline = text.lastIndexOf('\n', end - 1)
                if (lastNewline > start) {
                    end = lastNewline + 1  // 包含 \n
                }
                // lastNewline <= start 意味着整个 maxChars 区间内没 \n(超长单行),硬切
            }
            chunks.add(text.substring(start, end))
            start = end
        }
        return chunks
    }

    /**
     * 收集 heartbeat 元信息
     * 不依赖 RN, 不依赖业务事件, 永远能产出
     */
    private fun collectHeartbeat(): Pair<String, JSONObject> {
        val logFiles = BusinessLogWriter.listLogFiles(applicationContext)
        val sb = StringBuilder()
        sb.append("device_id_hash: ${getDeviceIdHash()}\n")
        sb.append("app_version: ${BuildConfig.VERSION_TAG}\n")
        sb.append("worker_tick_at: ${System.currentTimeMillis()}\n")
        sb.append("filesDir_total_files: ${logFiles.size}\n")
        if (logFiles.isNotEmpty()) {
            val totalBytes = logFiles.sumOf { it.length() }
            val newest = logFiles.first()
            sb.append("filesDir_total_bytes: $totalBytes\n")
            sb.append("filesDir_newest_file: ${newest.name}\n")
            sb.append("filesDir_newest_size: ${newest.length()}\n")
            sb.append("filesDir_newest_mtime: ${newest.lastModified()}\n")
        } else {
            sb.append("filesDir_empty: true\n")
        }
        val obj = JSONObject().apply {
            put("device_id_hash", getDeviceIdHash())
            put("app_version", BuildConfig.VERSION_TAG)
            put("worker_tick_at", System.currentTimeMillis())
            put("filesDir_total_files", logFiles.size)
            if (logFiles.isNotEmpty()) {
                val totalBytes = logFiles.sumOf { it.length() }
                val newest = logFiles.first()
                put("filesDir_total_bytes", totalBytes)
                put("filesDir_newest_file", newest.name)
                put("filesDir_newest_size", newest.length())
                put("filesDir_newest_mtime", newest.lastModified())
            } else {
                put("filesDir_empty", true)
            }
        }
        return Pair(sb.toString(), obj)
    }

    /**
     * 增量收集 — SharedPreferences 临时记录 offset (上传成功后才 commit)
     * 每次 tick 只读【上次上传之后的字节】(用 computeNextOffset 处理 F4 救历史)
     */
    private fun collectNewContentFromFilesDir(): String {
        val logFiles = BusinessLogWriter.listLogFiles(applicationContext)
        if (logFiles.isEmpty()) return ""

        val prefs = applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        pendingOffsets = mutableMapOf()
        val sb = StringBuilder()
        // 处理最新 3 个文件 (适应跨天 rotate)
        for ((idx, file) in logFiles.withIndex()) {
            if (idx >= 3) break
            val fileName = file.name
            val currentSize = file.length()
            val keyOffset = "$fileName.offset"
            val prevOffset = prefs.getLong(keyOffset, 0L)
            // F4 触发在这里 (computeNextOffset 内部检测 prevOffset==currentSize>MAX_LOG_CHARS)
            val effectiveOffset = computeNextOffset(prevOffset, currentSize)
            Log.i(TAG, "D1 A v3 collect: file=$fileName prev=$prevOffset eff=$effectiveOffset size=$currentSize")

            if (currentSize <= effectiveOffset) {
                Log.d(TAG, "file $fileName already fully uploaded (prev=$prevOffset eff=$effectiveOffset size=$currentSize)")
                continue
            }
            val skip = effectiveOffset
            val len = currentSize - effectiveOffset
            try {
                val newBytes = file.inputStream().use { inp ->
                    inp.skip(skip)
                    val buf = ByteArray(len.toInt())
                    var read = 0
                    while (read < buf.size) {
                        val r = inp.read(buf, read, buf.size - read)
                        if (r <= 0) break
                        read += r
                    }
                    String(buf, 0, read, Charsets.UTF_8)
                }
                sb.append("--- $fileName (offset=$effectiveOffset → $currentSize, ${newBytes.length} chars) ---\n")
                sb.append(newBytes)
                if (newBytes.isNotEmpty() && !newBytes.endsWith("\n")) sb.append("\n")

                // 暂存 pending offset, 上传成功后再 commit (F3: 全部 chunk 成功才 commit)
                pendingOffsets!!["$fileName.offset"] = currentSize
            } catch (e: Exception) {
                Log.w(TAG, "read new bytes from $fileName failed: ${e.message}")
            }
        }
        return sb.toString()
    }

    /**
     * 上传成功后 commit offset
     */
    private fun commitUploadOffsets() {
        if (pendingOffsets.isNullOrEmpty()) {
            Log.d(TAG, "no pending offsets to commit")
            return
        }
        try {
            val prefs = applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val editor = prefs.edit()
            for ((k, v) in pendingOffsets!!) {
                editor.putLong(k, v)
            }
            val committed = editor.commit()
            var verified = 0
            for ((k, expected) in pendingOffsets!!) {
                val actual = prefs.getLong(k, -1L)
                if (actual == expected) {
                    verified++
                    Log.i(TAG, "D1 A v3 offset committed: $k=$actual")
                } else {
                    Log.e(TAG, "D1 A v3 offset VERIFY FAILED: $k expected=$expected actual=$actual")
                }
            }
            Log.i(TAG, "D1 A v3 committed=${committed} verified=$verified/${pendingOffsets!!.size}: $pendingOffsets")
        } catch (e: Exception) {
            Log.w(TAG, "commit offsets failed: ${e.message}")
        }
    }

    // 暂存每次 tick 的新 offset, 上传成功后才写入 SharedPreferences
    private var pendingOffsets: MutableMap<String, Long>? = null

    /**
     * 2026-07-21 W5 F5: 客户端健康检查 (client>server 且 server 真的收到过 → rollback)
     *
     * 历史背景:
     *   v19.39/W4 时代 commit offset 时机跟上传成功不同步 → 即使上传失败,offset 也 commit 到了 currentSize
     *   → 下次 tick prevOffset < currentSize → 走默认 return prevOffset → 永远跳过 0-prevOffset
     *   表现: server 端 0-prevOffset 这部分字节永远丢失,client 以为已经上传过
     *
     * F5 修法:
     *   doWork() 开头先问 server "你收到了多少字节?"
     *   对比 client SharedPreferences offset:
     *     - client > server AND serverOffset > 0 → rollback client offset 到 server offset (重传丢失部分, server 真的收过但丢失)
     *     - client > server AND serverOffset == 0 → 不动 (server 死之前没收到过此文件, F3 上传时已经按 byte offset 走了, 不需要全传)
     *     - client < server → 不动 client (下次 tick 走正常流程,client offset 之前的 server 已有跳过)
     *     - client == server → 正常
     *   verify 失败 (server 连不上/超时) → catch 后跳过,走 F1-F4,下次 tick 再 verify
     *
     * 🆕 v19.52 (07-22): serverOffset==0 不 rollback 修复 — 防止 server 死期间累积的 7-21/7-22 log 一次性全重传 (之前 7-20 100% 重复)
     */
    private fun verifyOffsetsWithServer() {
        val prefs = applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val all = prefs.all
        if (all.isEmpty()) {
            Log.d(TAG, "F5 verify: SharedPreferences empty, skip")
            return
        }
        val deviceId = getDeviceId()
        val url = URL("$SERVER_BASE_URL/log-offset?device_id=$deviceId")
        val conn = (url.openConnection() as HttpURLConnection).apply {
            connectTimeout = 5_000
            readTimeout = 10_000
            requestMethod = "GET"
        }
        val respBody: String? = try {
            if (conn.responseCode in 200..299) {
                conn.inputStream.bufferedReader().use { it.readText() }
            } else {
                Log.w(TAG, "F5 verify HTTP ${conn.responseCode}, skip verify")
                null
            }
        } catch (e: Exception) {
            Log.w(TAG, "F5 verify exception (skip, 走 F1-F4): ${e.message}")
            null
        } finally {
            conn.disconnect()
        }
        if (respBody == null) return

        val resp = try { JSONObject(respBody) } catch (e: Exception) {
            Log.w(TAG, "F5 verify bad json: ${e.message}")
            return
        }
        val offsets = resp.optJSONObject("offsets") ?: JSONObject()

        val editor = prefs.edit()
        var rolledBack = 0
        for ((k, v) in all) {
            if (!k.endsWith(".offset")) continue
            val clientOffset = (v as? Long) ?: continue
            // key 格式: "business-YYYY-MM-DD.log.offset",server 用 "business-YYYY-MM-DD.log"
            val fileKey = k.removeSuffix(".offset")
            val serverOffset = offsets.optLong(fileKey, 0L)
            // 🆕 v19.52 (07-22): serverOffset==0 不 rollback 修复
            //   防止 server 死期间累积的 7-21/7-22 log 一次性全重传 (之前 7-20 100% 重复)
            //   原理: serverOffset==0 = server 死之前没收到过此文件, F3 上传时已经按 byte offset 走, 不需要全传
            //   serverOffset>0 才 rollback (真的收过但 commit 错位, v19.39/W4 真凶场景)
            if (clientOffset > serverOffset && serverOffset > 0L) {
                Log.w(TAG, "F5 rollback: $fileKey client=$clientOffset > server=$serverOffset, reset to $serverOffset")
                editor.putLong(k, serverOffset)
                rolledBack++
            } else if (clientOffset > serverOffset && serverOffset == 0L) {
                Log.d(TAG, "F5 skip rollback: $fileKey client=$clientOffset > server=0 (server 没收到过, 不重传整文件)")
            }
            // clientOffset == serverOffset: 正常
            // clientOffset < serverOffset: 不动 (不可能场景,client 没机会比 server 落后)
        }
        if (rolledBack > 0) {
            editor.apply()
            Log.w(TAG, "F5 verify done: rolledBack=$rolledBack files")
        } else {
            Log.d(TAG, "F5 verify done: no rollback needed (${offsets.length()} files on server)")
        }
    }

    /**
     * F3: 单 chunk 上传,带 seq/total_seq/terminal 字段
     * server 端按 client_ts_ms + source 累积,terminal=true 触发最终落盘
     * client 等 server 200 ack 才算成功 (失败 retry)
     */
    private fun uploadChunk(
        chunk: String,
        seq: Int,
        totalSeq: Int,
        heartbeatObj: JSONObject,
        isNewData: Boolean,
        clientTs: Long
    ): Boolean {
        return try {
            val body = JSONObject().apply {
                put("device_id", getDeviceId())
                put("user_id", getUserId())
                put("app_version", "1.6.4.1-fix-ABC-W5")  // 标识 W5 版本
                put("timestamp", clientTs)  // F3: 同一 tick 共用 timestamp
                put("log", chunk)
                put("source", BuildConfig.VERSION_TAG)
                put("heartbeat", heartbeatObj)
                put("is_new_data", isNewData)
                put("worker_tag", TAG)
                // F3 分片标识
                put("seq", seq)
                put("total_seq", totalSeq)
                put("terminal", seq == totalSeq - 1)
            }

            val url = URL(UPLOAD_URL)
            val conn = url.openConnection() as HttpURLConnection
            // 🆕 D8 A (07-23 老板拍板): OkHttp readTimeout 30s→90s, connectTimeout 10s→30s
            //   治 vivo 客户端 chunk 0 timeout 真根因 (ping 200ms + TLS + server 写盘排队 > 30s)
            //   修后 D1 A partial commit 才能真正生效 (chunk 0 成功 + chunk 1 失败场景)
            conn.connectTimeout = 30_000
            conn.readTimeout = 90_000
            conn.requestMethod = "POST"
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            conn.doOutput = true

            try {
                OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use {
                    it.write(body.toString())
                }
                val code = conn.responseCode
                if (code in 200..299) true
                else {
                    val err = try {
                        conn.errorStream?.bufferedReader()?.readText()?.take(200)
                    } catch (_: Exception) { "" }
                    Log.w(TAG, "chunk $seq/$totalSeq http=$code err=$err")
                    false
                }
            } finally {
                conn.disconnect()
            }
        } catch (e: Exception) {
            Log.w(TAG, "upload chunk $seq exception: ${e.message}")
            false
        }
    }

    private fun getDeviceIdHash(): String {
        return try {
            val rawId = android.provider.Settings.Secure.getString(
                applicationContext.contentResolver,
                android.provider.Settings.Secure.ANDROID_ID
            ) ?: "unknown"
            val h = java.security.MessageDigest.getInstance("SHA-256").digest(rawId.toByteArray(Charsets.UTF_8))
            java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(h.copyOfRange(0, 9))
        } catch (e: Exception) {
            "unknown"
        }
    }

    private fun sanitize(text: String): String {
        var s = text
        s = PHONE.matcher(s).replaceAll("1**********")
        s = EMAIL.matcher(s).replaceAll("***@***")
        s = ID_CARD.matcher(s).replaceAll("******************")
        return s
    }

    private fun getDeviceId(): String {
        return try {
            android.provider.Settings.Secure.getString(
                applicationContext.contentResolver,
                android.provider.Settings.Secure.ANDROID_ID
            ) ?: "unknown-${System.currentTimeMillis()}"
        } catch (e: Exception) {
            "unknown-${System.currentTimeMillis()}"
        }
    }

    /**
     * 从 Build.MODEL 推断 user_id (与机型一致, 后续改注册用户名)
     * - nova 7 5G (JEF-AN00) → "nova"
     * - vivo V2166A → "vivo"
     * - 其他 → "unknown" (server 端会落 legacy/)
     */
    private fun getUserId(): String {
        return try {
            val model = android.os.Build.MODEL ?: return "unknown"
            val manufacturer = android.os.Build.MANUFACTURER ?: ""
            when {
                model.equals("JEF-AN00", ignoreCase = true) -> "nova"
                model.equals("V2166A", ignoreCase = true) -> "vivo"
                manufacturer.equals("HUAWEI", ignoreCase = true) && model.contains("nova", ignoreCase = true) -> "nova"
                manufacturer.equals("vivo", ignoreCase = true) -> "vivo"
                else -> "unknown"
            }
        } catch (e: Exception) {
            "unknown"
        }
    }
}
