package com.zbb.automation.v4

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Paint
import android.graphics.Matrix
import kotlin.math.max
import kotlin.math.min

/**
 * 图像预处理工具类
 * 用于提升 OCR 识别精度，特别是中文识别
 *
 * 预处理流程：
 * 1. 缩放到合适尺寸（避免过大导致识别慢）
 * 2. 灰度化
 * 3. 对比度增强
 * 4. 锐化
 * 5. 可选：二值化（对某些场景有效）
 */
object ImagePreprocessor {

    /**
     * 预处理图片，提升 OCR 识别率
     * @param bitmap 输入的原始截图
     * @param enhanceContrast 是否增强对比度（推荐开启）
     * @param sharpen 是否锐化（推荐开启）
     * @return 预处理后的图片
     */
    fun preprocess(
        bitmap: Bitmap,
        enhanceContrast: Boolean = true,
        sharpen: Boolean = true
    ): Bitmap {
        var result = bitmap.copy(Bitmap.Config.ARGB_8888, true)

        // 1. 缩放到合适尺寸（推荐 1920x1080 以内）
        result = scaleDownIfNeeded(result, 1920)

        // 2. 灰度化
        result = toGrayscale(result)

        // 3. 增强对比度
        if (enhanceContrast) {
            result = enhanceContrast(result, 1.5f)  // 对比度增强 1.5 倍
        }

        // 4. 锐化
        if (sharpen) {
            result = sharpen(result, 0.5f)
        }

        return result
    }

    /**
     * 深度预处理（适用于低对比度截图）
     */
    fun deepPreprocess(bitmap: Bitmap): Bitmap {
        var result = bitmap.copy(Bitmap.Config.ARGB_8888, true)

        // 1. 缩放
        result = scaleDownIfNeeded(result, 1920)

        // 2. 灰度化
        result = toGrayscale(result)

        // 3. 强力对比度增强
        result = enhanceContrast(result, 2.0f)

        // 4. 自适应亮度调整
        result = adjustBrightness(result, 10f)

        // 5. 强力锐化
        result = sharpen(result, 0.7f)

        // 6. 二值化
        result = autoThreshold(result)

        return result
    }

    /**
     * 如果图片过大，缩放到合适尺寸
     */
    private fun scaleDownIfNeeded(bitmap: Bitmap, maxDimension: Int): Bitmap {
        val width = bitmap.width
        val height = bitmap.height

        if (width <= maxDimension && height <= maxDimension) {
            return bitmap
        }

        val scale = maxDimension.toFloat() / max(width, height)
        val newWidth = (width * scale).toInt()
        val newHeight = (height * scale).toInt()

        val matrix = Matrix()
        matrix.postScale(scale, scale)

        return Bitmap.createBitmap(bitmap, 0, 0, width, height, matrix, true)
    }

    /**
     * 转换为灰度图
     */
    private fun toGrayscale(bitmap: Bitmap): Bitmap {
        val width = bitmap.width
        val height = bitmap.height

        val result = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(result)
        val paint = Paint()

        val colorMatrix = ColorMatrix().apply {
            setSaturation(0f)
        }

        paint.colorFilter = ColorMatrixColorFilter(colorMatrix)
        canvas.drawBitmap(bitmap, 0f, 0f, paint)

        return result
    }

    /**
     * 增强对比度
     */
    private fun enhanceContrast(bitmap: Bitmap, contrast: Float): Bitmap {
        val width = bitmap.width
        val height = bitmap.height

        val result = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(result)
        val paint = Paint()

        val scale = contrast
        val translate = (-.5f * scale + .5f) * 255f

        val colorMatrix = ColorMatrix(floatArrayOf(
            scale, 0f, 0f, 0f, translate,
            0f, scale, 0f, 0f, translate,
            0f, 0f, scale, 0f, translate,
            0f, 0f, 0f, 1f, 0f
        ))

        paint.colorFilter = ColorMatrixColorFilter(colorMatrix)
        canvas.drawBitmap(bitmap, 0f, 0f, paint)

        return result
    }

    /**
     * 调整亮度
     */
    private fun adjustBrightness(bitmap: Bitmap, brightness: Float): Bitmap {
        val width = bitmap.width
        val height = bitmap.height

        val result = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(result)
        val paint = Paint()

        val colorMatrix = ColorMatrix(floatArrayOf(
            1f, 0f, 0f, 0f, brightness,
            0f, 1f, 0f, 0f, brightness,
            0f, 0f, 1f, 0f, brightness,
            0f, 0f, 0f, 1f, 0f
        ))

        paint.colorFilter = ColorMatrixColorFilter(colorMatrix)
        canvas.drawBitmap(bitmap, 0f, 0f, paint)

        return result
    }

    /**
     * 锐化
     */
    private fun sharpen(bitmap: Bitmap, intensity: Float): Bitmap {
        val width = bitmap.width
        val height = bitmap.height

        val result = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(result)
        val paint = Paint()

        // 锐化矩阵
        val center = intensity + 1f
        val colorMatrix = ColorMatrix(floatArrayOf(
            center, 0f, 0f, 0f, 0f,
            0f, center, 0f, 0f, 0f,
            0f, 0f, center, 0f, 0f,
            0f, 0f, 0f, 1f, 0f
        ))

        paint.colorFilter = ColorMatrixColorFilter(colorMatrix)
        canvas.drawBitmap(bitmap, 0f, 0f, paint)

        return result
    }

    /**
     * 自动阈值二值化
     */
    private fun autoThreshold(bitmap: Bitmap): Bitmap {
        val width = bitmap.width
        val height = bitmap.height

        val pixels = IntArray(width * height)
        bitmap.getPixels(pixels, 0, width, 0, 0, width, height)

        // 计算平均灰度作为阈值
        var sum = 0L
        for (pixel in pixels) {
            val r = (pixel shr 16) and 0xFF
            val g = (pixel shr 8) and 0xFF
            val b = pixel and 0xFF
            val gray = (0.299 * r + 0.587 * g + 0.114 * b).toInt()
            sum += gray
        }
        val threshold = (sum / pixels.size).toInt()

        // 应用阈值
        for (i in pixels.indices) {
            val pixel = pixels[i]
            val r = (pixel shr 16) and 0xFF
            val g = (pixel shr 8) and 0xFF
            val b = pixel and 0xFF
            val gray = (0.299 * r + 0.587 * g + 0.114 * b).toInt()

            val newValue = if (gray > threshold) 255 else 0
            pixels[i] = (0xFF shl 24) or (newValue shl 16) or (newValue shl 8) or newValue
        }

        bitmap.setPixels(pixels, 0, width, 0, 0, width, height)
        return bitmap
    }
}
