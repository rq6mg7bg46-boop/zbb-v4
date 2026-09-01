package com.zbb.automation.v4

import android.graphics.Bitmap
import android.graphics.Rect
import android.util.Log
// V32.36.7: ML Kit imports 已删 (老板 09-01 拍板 OCR 误判率高, 全删)
//   com.google.mlkit.vision.common.InputImage
//   com.google.mlkit.vision.text.TextRecognition
//   com.google.mlkit.vision.text.TextRecognizer
//   com.google.mlkit.vision.text.latin.TextRecognizerOptions
// 替代: OCR 已禁用, recognize/recognizeDeep/recognizeChineseLatin 全部返回 empty list
//       业务流程 judge.isScreenText 改 A11y, click.byText 删 useOcr

/**
 * OCR 识别助手 (V32.36.7 已禁用, 老板拍板 OCR 误判率高, 全删)
 *
 * 历史 (V32.36.6 之前): 用 ML Kit (中文 + 拉丁模型) 识别屏幕文字
 * 当前 (V32.36.7): 函数签名保留 (避免破坏 AutomationModule 编译), 但全部返回 empty
 * 业务流程已切到 A11y (judge.isScreenText + click.byText A11y only)
 */
object OcrHelper {

    private const val TAG = "OcrHelper"

    // V32.36.7: 删 chineseRecognizer (ML Kit TextRecognizer 已删依赖)
    // private val chineseRecognizer: TextRecognizer by lazy { ... }
    // V32.36.7: 删 latinRecognizer (同上)

    // 是否使用预处理
    var usePreprocessing: Boolean = true

    // 是否使用纠错
    var useCorrection: Boolean = true

    /**
     * 识别图片中的文字 (V32.36.7 禁用, 老板 09-01 拍板 OCR 全删)
     * @param bitmap 输入图片 (参数保留, 不使用)
     * @param callback 回调函数 (签名保留, 调用 callback(emptyList, "OCR_DISABLED"))
     */
    fun recognize(
        bitmap: Bitmap,
        callback: (List<OcrResult>, error: String?) -> Unit
    ) {
        Log.w(TAG, "OCR 已禁用 (V32.36.7 老板拍板), 业务流程切到 A11y judge.isScreenText")
        callback(emptyList(), "OCR_DISABLED_V32_36_7")
    }

    /**
     * 查找指定文字的位置 (V32.36.7 禁用, OCR 全删)
     * @param bitmap 输入图片 (参数保留, 不使用)
     * @param keyword 要查找的文字 (参数保留, 不使用)
     * @param callback 回调函数 (签名保留, 调用 callback(null, "OCR_DISABLED"))
     */
    fun findTextPosition(
        bitmap: Bitmap,
        keyword: String,
        callback: (Pair<Int, Int>?, error: String?) -> Unit
    ) {
        Log.w(TAG, "OCR 已禁用 (V32.36.7 老板拍板), findTextPosition 返回 null")
        callback(null, "OCR_DISABLED_V32_36_7")
    }

    /**
     * 深度识别模式 (V32.36.7 禁用, OCR 全删)
     * @param bitmap 输入图片 (参数保留, 不使用)
     * @param callback 回调函数 (签名保留, 调用 callback(emptyList, "OCR_DISABLED"))
     */
    fun recognizeDeep(
        bitmap: Bitmap,
        callback: (List<OcrResult>, error: String?) -> Unit
    ) {
        Log.w(TAG, "OCR 已禁用 (V32.36.7 老板拍板), recognizeDeep 返回 empty")
        callback(emptyList(), "OCR_DISABLED_V32_36_7")
    }
}
