package com.zbb.automation.v4

import android.graphics.Rect
import android.util.Log

/**
 * OCR 识别结果
 */
data class OcrResult(
    val text: String,
    val confidence: Float,
    val boundingBox: Rect
)
