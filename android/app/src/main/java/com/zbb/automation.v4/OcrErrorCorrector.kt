package com.zbb.automation.v4

import android.util.Log

/**
 * OCR 识别结果纠错器
 * 
 * 在 OCR 识别结束后、结果返回给主项目前，对识别错误的文字进行纠正
 */
object OcrErrorCorrector {

    private const val TAG = "OcrErrorCorrector"

    /**
     * 精确匹配纠错表
     */
    private val exactCorrectionMap = mapOf(
        // ========== 导航栏 ==========
        "|首页" to "首页",
        "|客户" to "客户",
        "|更多》" to "更多",
        "|我的" to "我的",
        "|t的" to "我的",
        "t的" to "我的",
        "|消息" to "消息",
        "1的" to "我的",
        "1消息" to "消息",
        
        // ========== 热门识别错误 ==========
        "本周楼市市咨询分折" to "本周楼市咨询分析",
        "本周楼市咨询分析" to "本周楼市咨询分析",
        "好盘维荐" to "好盘推荐",
        "好盘推荐" to "好盘推荐",
        
        // ========== 热门话题 ==========
        "热点话题誰將主領導外來來發展趨勢" to "热点话题谁将主导外来发展趋势",
        "热点话题 谁将主领导外来來发展 趋势" to "热点话题谁将主导外来发展趋势",
        "热点话题達得主领导外来来发展趋势" to "热点话题谁将主导外来发展趋势",
        "热点话题誰將主領導外來來發展趨勢" to "热点话题谁将主导外来发展趋势",
        
        // ========== 输入框提示 ==========
        "Q请入项至名秒" to "请输入项目名称",
        "Q请输入项目名称" to "请输入项目名称",
        "请入项至名秒" to "请输入项目名称",
        "请输入项目名称" to "请输入项目名称",
        
        // ========== 状态标签 ==========
        "『待售" to "「待售」",
        "「待售" to "「待售」",
        "(es作)" to "合作",
        "es作" to "合作",
        
        // ========== 导航菜单 ==========
        "我要报" to "我要报备",
        "我要报备" to "我要报备",
        "我的报" to "我的报备",
        "我的报备" to "我的报备",
        "我的报备备" to "我的报备",
        "我釣收" to "我的收藏",
        "我的收藏" to "我的收藏",
        "接盘夕表" to "楼盘列表",
        "主山水代宅" to "楼盘列表",
        "楼盘列表" to "楼盘列表",
        
        // ========== 底部导航 ==========
        "首页" to "首页",
        "客户" to "客户",
        "消息" to "消息",
        "我的" to "我的",
        
        // ========== 小程序名称 ==========
        "新绿城云" to "新绿城云",
        "新绿城云家" to "新绿城云",
        
        // ========== 报备相关 ==========
        "我要推荐" to "我要推荐",
        "客户姓名" to "客户姓名",
        "客户电话" to "客户电话",
        "立即报备" to "立即报备",
        "报备成功" to "报备成功",
        
        // ========== 楼盘名称 ==========
        "郑州保利山水和颂" to "郑州保利山水和颂",
        "郵州保利山水和颂" to "郑州保利山水和颂",
        
        // ========== 价格单位 ==========
        "16500-19500 元/me" to "16500-19500 元/m²",
        "16500-19500 元/r" to "16500-19500 元/m²",
        "16500-19500元/me" to "16500-19500元/m²",
        "16500-19500 元.r" to "16500-19500 元/m²",
        "16500-19500元.r" to "16500-19500元/m²",
        "元/me" to "元/m²",
        "元/r" to "元/m²",
        
        // ========== 其他描述 ==========
        "回视合同而定" to "视合同而定",
        "側視合同百法" to "视合同而定",
        "側视合同百法" to "视合同而定",
        "視合同百法" to "视合同而定",
        "視同合同而定" to "视合同而定",
        "視合同而定" to "视合同而定",
        "税视合同而定" to "视合同而定",
        "税視合同而定" to "视合同而定"
    )

    /**
     * 结尾多余符号清理
     */
    private val endSymbolsToRemove = listOf(
        "O",
        "q"
    )

    /**
     * 整体替换规则
     */
    private val wholeTextCorrections = mapOf(
        "我的报备备" to "我的报备",
        "楼盘列表列表" to "楼盘列表",
        "我的收藏藏" to "我的收藏",
        "首页页" to "首页"
    )

    /**
     * 纠正单个识别结果
     */
    fun correct(text: String): String {
        if (text.isEmpty()) return text

        var corrected = text
        
        // Step 0: 整体替换
        wholeTextCorrections[corrected]?.let {
            Log.d(TAG, "整体替换: '$corrected' → '$it'")
            return it
        }
        
        // Step 1: 精确匹配
        exactCorrectionMap[corrected]?.let {
            Log.d(TAG, "精确纠正: '$corrected' → '$it'")
            return it
        }
        
        // Step 2: 包含关系匹配
        for ((wrong, right) in exactCorrectionMap) {
            if (corrected.contains(wrong)) {
                val newText = corrected.replace(wrong, right)
                if (newText != corrected) {
                    Log.d(TAG, "包含纠正: '$corrected' → '$newText'")
                    corrected = newText
                    break
                }
            }
        }

        return corrected
    }

    /**
     * 纠正多个识别结果
     */
    fun correctResults(results: List<OcrResult>): List<OcrResult> {
        return results.map { result ->
            val correctedText = correct(result.text)
            if (correctedText != result.text) {
                OcrResult(
                    text = correctedText,
                    confidence = result.confidence,
                    boundingBox = result.boundingBox
                )
            } else {
                result
            }
        }
    }
}
