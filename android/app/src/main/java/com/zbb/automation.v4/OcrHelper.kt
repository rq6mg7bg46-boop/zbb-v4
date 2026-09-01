package com.zbb.automation.v4

import android.graphics.Bitmap
import android.graphics.Rect
import android.util.Log
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.latin.TextRecognizerOptions

/**
 * OCR 识别助手（ML Kit + 图像预处理）
 * 
 * 预处理流程：
 * 1. 缩放到合适尺寸
 * 2. 灰度化
 * 3. 对比度增强（1.5x）
 * 4. 锐化
 */
object OcrHelper {

    private const val TAG = "OcrHelper"

    // 中文识别器（使用默认识别器，已包含中文支持）
    private val chineseRecognizer: TextRecognizer by lazy {
        TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    }

    // 是否使用预处理
    var usePreprocessing: Boolean = true

    // 是否使用纠错
    var useCorrection: Boolean = true

    /**
     * 识别图片中的文字
     * @param bitmap 输入图片
     * @param callback 回调函数
     */
    fun recognize(
        bitmap: Bitmap,
        callback: (List<OcrResult>, error: String?) -> Unit
    ) {
        val startTime = System.currentTimeMillis()

        // 图像预处理
        val processedBitmap = if (usePreprocessing) {
            ImagePreprocessor.preprocess(bitmap, enhanceContrast = true, sharpen = true)
        } else {
            bitmap
        }

        Log.d(TAG, "图像预处理完成，耗时: ${System.currentTimeMillis() - startTime}ms")

        try {
            val inputImage = InputImage.fromBitmap(processedBitmap, 0)

            chineseRecognizer.process(inputImage)
                .addOnSuccessListener { visionText ->
                    val results = mutableListOf<OcrResult>()

                    for (block in visionText.textBlocks) {
                        for (line in block.lines) {
                            val text = line.text.trim()
                            if (text.isNotEmpty()) {
                                results.add(
                                    OcrResult(
                                        text = text,
                                        confidence = line.confidence ?: 0f,
                                        boundingBox = line.boundingBox ?: Rect(0, 0, 0, 0)
                                    )
                                )
                            }
                        }
                    }

                    Log.d(TAG, "OCR 识别完成，耗时: ${System.currentTimeMillis() - startTime}ms")
                    Log.d(TAG, "识别到 ${results.size} 个文本块")

                    // 打印识别结果
                    if (results.isNotEmpty()) {
                        Log.d(TAG, "识别结果:\n${results.joinToString("\n") { "${it.text} (${it.confidence})" }}")
                    }

                    // 应用纠错
                    val finalResults = if (useCorrection) {
                        OcrErrorCorrector.correctResults(results)
                    } else {
                        results
                    }
                    
                    Log.d(TAG, "纠错后结果:\n${finalResults.joinToString("\n") { "${it.text}" }}")

                    callback(finalResults, null)
                }
                .addOnFailureListener { e ->
                    Log.e(TAG, "OCR 识别失败: ${e.message}", e)
                    callback(emptyList(), e.message)
                }

        } catch (e: Exception) {
            Log.e(TAG, "OCR 处理异常: ${e.message}", e)
            callback(emptyList(), e.message)
        }
    }

    /**
     * 查找指定文字的位置
     * @param bitmap 输入图片
     * @param keyword 要查找的文字
     * @param callback 回调，返回中心点坐标 (x, y)
     */
    fun findTextPosition(
        bitmap: Bitmap,
        keyword: String,
        callback: (Pair<Int, Int>?, error: String?) -> Unit
    ) {
        recognize(bitmap) { results, error ->
            if (error != null) {
                callback(null, error)
                return@recognize
            }

            if (results.isEmpty()) {
                callback(null, "未识别到任何文字")
                return@recognize
            }

            // 精确匹配
            for (result in results) {
                if (result.text == keyword) {
                    val centerX = result.boundingBox.centerX()
                    val centerY = result.boundingBox.centerY()
                    Log.d(TAG, "精确匹配 '$keyword' at ($centerX, $centerY)")
                    callback(Pair(centerX, centerY), null)
                    return@recognize
                }
            }

            // 模糊匹配（包含）
            for (result in results) {
                if (result.text.contains(keyword)) {
                    val centerX = result.boundingBox.centerX()
                    val centerY = result.boundingBox.centerY()
                    Log.d(TAG, "模糊匹配 '$keyword' (实际: '${result.text}') at ($centerX, $centerY)")
                    callback(Pair(centerX, centerY), null)
                    return@recognize
                }
            }

            // 部分字符匹配
            for (char in keyword) {
                for (result in results) {
                    if (result.text.contains(char)) {
                        val centerX = result.boundingBox.centerX()
                        val centerY = result.boundingBox.centerY()
                        Log.d(TAG, "部分匹配 '$keyword' 在 '${result.text}' 中 at ($centerX, $centerY)")
                        callback(Pair(centerX, centerY), null)
                        return@recognize
                    }
                }
            }

            Log.d(TAG, "未找到 '$keyword'")
            callback(null, "未找到 '$keyword'")
        }
    }

    /**
     * 深度识别模式
     */
    fun recognizeDeep(
        bitmap: Bitmap,
        callback: (List<OcrResult>, error: String?) -> Unit
    ) {
        val startTime = System.currentTimeMillis()

        val processedBitmap = ImagePreprocessor.deepPreprocess(bitmap)

        Log.d(TAG, "深度预处理完成，耗时: ${System.currentTimeMillis() - startTime}ms")

        try {
            val inputImage = InputImage.fromBitmap(processedBitmap, 0)

            chineseRecognizer.process(inputImage)
                .addOnSuccessListener { visionText ->
                    val results = mutableListOf<OcrResult>()

                    for (block in visionText.textBlocks) {
                        for (line in block.lines) {
                            val text = line.text.trim()
                            if (text.isNotEmpty()) {
                                results.add(
                                    OcrResult(
                                        text = text,
                                        confidence = line.confidence ?: 0f,
                                        boundingBox = line.boundingBox ?: Rect(0, 0, 0, 0)
                                    )
                                )
                            }
                        }
                    }

                    val finalResults = if (useCorrection) {
                        OcrErrorCorrector.correctResults(results)
                    } else {
                        results
                    }

                    callback(finalResults, null)
                }
                .addOnFailureListener { e ->
                    callback(emptyList(), e.message)
                }

        } catch (e: Exception) {
            callback(emptyList(), e.message)
        }
    }
}
