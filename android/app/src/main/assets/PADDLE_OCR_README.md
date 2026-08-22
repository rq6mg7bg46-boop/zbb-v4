# PaddleOCR 模型文件下载说明

## 概述
PaddleOCR 需要以下模型文件才能工作：
1. **检测模型** (det_chinese.onnx) - 检测文字区域
2. **识别模型** (rec_chinese.onnx) - 识别文字内容
3. **字典文件** (ppocr_keys_v1.txt) - 中文字典

## 下载方式

### 方式一：从 PaddleOCR 官方 GitHub 下载（推荐）

```bash
# 创建目录
mkdir -p paddle_ocr

# 下载检测模型 (约 9MB)
curl -L -o paddle_ocr/det_chinese.onnx https://github.com/PaddlePaddle/PaddleOCR/raw/main/docs/../models/ch_PP-OCRv3/serving/det/inference.pdiparams

# 下载识别模型 (约 10MB)
curl -L -o paddle_ocr/rec_chinese.onnx https://github.com/PaddlePaddle/PaddleOCR/raw/main/docs/../models/ch_PP-OCRv3/serving/rec/inference.pdiparams

# 下载字典文件
curl -L -o paddle_ocr/ppocr_keys_v1.txt https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/main/ppocr/utils/ppocr_keys_v1.txt
```

### 方式二：从 Gitee 镜像下载（国内推荐）

```bash
# 创建目录
mkdir -p paddle_ocr

# 下载检测模型
wget -O paddle_ocr/det_chinese.onnx https://gitee.com/paddlepaddle/PaddleOCR/raw/main/models/ch_PP-OCRv3/serving/det/inference.pdiparams

# 下载识别模型
wget -O paddle_ocr/rec_chinese.onnx https://gitee.com/paddlepaddle/PaddleOCR/raw/main/models/ch_PP-OCRv3/serving/rec/inference.pdiparams

# 下载字典文件
wget -O paddle_ocr/ppocr_keys_v1.txt https://gitee.com/paddlepaddle/PaddleOCR/raw/main/ppocr/utils/ppocr_keys_v1.txt
```

## 模型文件放置位置

将下载的模型文件放到 Android 设备的以下目录：

```
/data/data/com.zbb.automation/files/paddle_ocr/
├── det_chinese.onnx      # 检测模型
├── rec_chinese.onnx      # 识别模型
└── ppocr_keys_v1.txt     # 字典文件
```

### 或者在应用首次启动时自动下载

应用代码中已包含模型检查逻辑，如果模型文件不存在会输出日志提示。

## 验证模型文件

下载完成后，验证文件是否存在：

```bash
ls -la paddle_ocr/
```

应该看到三个文件，每个文件大小应该 > 0。

## 常见问题

### Q: 模型文件下载失败怎么办？
A: 尝试使用代理或 VPN，或者从其他镜像源下载。

### Q: 模型文件太大？
A: 可以使用更轻量的模型（如 ch_PP-OCRv2），但识别率会降低。

### Q: PaddleOCR 初始化失败？
A: 检查：
1. 模型文件是否完整
2. 模型文件路径是否正确
3. NDK 是否正确配置

## 备选方案

如果 PaddleOCR 集成遇到问题，可以考虑使用以下替代方案：

1. **Tesseract OCR (tess-two)** - 轻量级，API 简单
2. **Google MLKit** - 需要 Google Play 服务
3. **远程 OCR API** - 通过 HTTP 调用后端服务识别

---
生成时间: 2024年
