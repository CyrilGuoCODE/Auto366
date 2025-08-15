import sys
import json
import time
import pyautogui
import re
from PIL import Image, ImageEnhance, ImageFilter
import pytesseract
from pytesseract import Output
import linecache
import os

# 设置UTF-8编码输出
os.environ['PYTHONIOENCODING'] = 'utf-8'

# 设置控制台编码
if sys.platform.startswith('win'):
    import codecs

    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.detach())
    sys.stderr = codecs.getwriter('utf-8')(sys.stderr.detach())

# 设置Tesseract路径
pytesseract.pytesseract.tesseract_cmd = r'.\tesseract\tesseract.exe'

# 设置语言包路径
os.environ['TESSDATA_PREFIX'] = r'.\tessdata'


def find_first_occurrence(filename, search_text):
    try:
        with open(filename, 'r', encoding='utf-8') as file:
            for line_num, line in enumerate(file, 1):
                if search_text in line:
                    return line_num
        return -1
    except FileNotFoundError:
        raise ValueError(f"错误: 文件 {filename} 未找到")
    except Exception as e:
        raise ValueError(f"读取文件时发生错误: {e}")


def get_line_with_linecache(filename, line_number):
    try:
        line = linecache.getline(filename, line_number)
        return line.rstrip('\n') if line else None
    except Exception as e:
        raise ValueError(f"读取文件时发生错误: {e}")


def longest_common_substring(s1, s2):
    m, n = len(s1), len(s2)
    # DP 表，dp[i][j] 表示 s1[0..i-1] 和 s2[0..j-1] 的最长公共子串长度
    dp = [[0] * (n + 1) for _ in range(m + 1)]
    max_len = 0  # 最长公共子串的长度

    for i in range(1, m + 1):
        for j in range(1, n + 1):
            if s1[i - 1] == s2[j - 1]:
                dp[i][j] = dp[i - 1][j - 1] + 1
                if dp[i][j] > max_len:
                    max_len = dp[i][j]
            else:
                dp[i][j] = 0

    return max_len


def detect_language(text):
    """检测文本语言（简体中文或英文）"""
    if re.search(r'[\u4e00-\u9fff]', text):  # 检测中文字符
        return 'zh'
    return 'en'


def preprocess_text(text):
    """预处理文本：移除标点、空格，统一为小写"""
    text = re.sub(r'\b[a-zA-Z]+\.\s*', '', text)
    text = re.sub(r'[^\w\u4e00-\u9fff]', '', text)  # 保留字母数字和中文字符
    return text.lower()


def preprocess_image(image, invert=False):
    """
    图像预处理：增强对比度、锐化、二值化
    :param image: PIL图像对象
    :param invert: 是否反色处理（用于深色背景）
    :return: 预处理后的图像
    """
    # 转换为灰度图
    img = image.convert('L')

    # 增强对比度
    enhancer = ImageEnhance.Contrast(img)
    img = enhancer.enhance(2.0)  # 对比度增强2倍

    # 锐化图像
    img = img.filter(ImageFilter.SHARPEN)

    # 二值化处理
    threshold = 160 if invert else 140
    img = img.point(lambda p: 0 if p < threshold else 255)

    # 深色背景需要反色处理（白色文字变黑色）
    if invert:
        img = img.point(lambda p: 255 - p)

    return img


def capture_and_translate(pos1, pos2):
    # 截取pos1区域（提示词区域 - 白底黑字）
    screenshot1 = pyautogui.screenshot(region=(
        pos1['x'] - 5,  # 扩展区域避免边缘裁剪
        pos1['y'] - 5,
        pos1['width'] + 10,
        pos1['height'] + 10
    ))

    # 预处理提示词区域图像
    processed_img1 = preprocess_image(screenshot1)
    processed_img1.save('debug_pos1.png')  # 保存调试图像

    # OCR识别pos1区域的文本
    original_text = pytesseract.image_to_string(
        processed_img1,
        lang='chi_sim+eng',  # 中文优先
        config='--psm 7 --oem 1'  # 单行文本模式，LSTM引擎
    ).strip()

    # 检测语言并设置翻译方向
    lang = detect_language(original_text)
    if lang == 'zh':
        target_lang = 'en'
        from_lang = 'zh'
    else:
        target_lang = 'zh'
        from_lang = 'en'

    # 翻译文本（通过词库匹配）
    processed_original = preprocess_text(original_text)
    line = find_first_occurrence(f'translate-{from_lang}.txt', processed_original)
    processed_translated = get_line_with_linecache(f'translate-{target_lang}.txt', line) or ""

    # 截取pos2区域（选项区域 - 深蓝底白字）
    screenshot2 = pyautogui.screenshot(region=(
        pos2['x'],
        pos2['y'],
        pos2['width'],
        pos2['height']
    ))

    # 预处理选项区域图像（反色处理）
    processed_img2 = preprocess_image(screenshot2, invert=True)
    processed_img2.save('debug_pos2.png')  # 保存调试图像

    # 获取pos2区域的OCR详细数据
    ocr_data = pytesseract.image_to_data(
        processed_img2,
        lang='eng+chi_sim',
        output_type=Output.DICT,
        config='--psm 6 --oem 1 -c preserve_interword_spaces=1'  # 稀疏文本模式
    )

    # 在pos2区域查找匹配的文本位置
    matched_position = None
    max_lcs = -1
    min_required_length = 2  # 最小匹配字符长度

    # 设置语言相关的最小长度和置信度阈值
    min_length = 2 if target_lang == 'zh' else 4
    min_confidence = 80  # 提高置信度要求

    for i in range(len(ocr_data['text'])):
        text = ocr_data['text'][i].strip()
        conf = int(ocr_data['conf'][i])
        word_length = len(text)

        # 跳过空文本和低置信度文本
        if not text or word_length < min_required_length:
            continue

        # 检查置信度和文本长度
        if conf < min_confidence or word_length < min_length:
            continue

        processed_text = preprocess_text(text)
        lcs = longest_common_substring(processed_text, processed_translated)

        # 调试输出
        print(f"匹配候选: '{text}' (置信度: {conf}%) vs '{processed_translated}' -> LCS: {lcs}", flush=True)

        # 更新最佳匹配
        if lcs > max_lcs:
            max_lcs = lcs
            matched_position = {
                'x': ocr_data['left'][i] + pos2['x'],
                'y': ocr_data['top'][i] + pos2['y'],
                'width': ocr_data['width'][i],
                'height': ocr_data['height'][i]
            }

    return {
        'original_text': original_text,
        'translated_text': processed_translated,
        'original_data': ocr_data,
        'target_lang': target_lang,
        'matched_position': matched_position
    }


if __name__ == '__main__':
    # 解析命令行参数（两个位置区域）
    if len(sys.argv) < 2:
        raise ValueError('需要提供两个位置区域参数')

    while True:
        try:
            # 解析参数
            params = json.loads(sys.argv[1])
            pos1 = params['pos1']
            pos2 = params['pos2']

            # 执行OCR和匹配
            result = capture_and_translate(pos1, pos2)

            # 确保输出完整的JSON
            print(json.dumps(result, ensure_ascii=False), flush=True)
        except Exception as e:
            # 输出错误信息
            error_result = {
                'error': str(e),
                'original_text': '',
                'translated_text': '',
                'original_data': {},
                'target_lang': '',
                'matched_position': None
            }
            print(json.dumps(error_result, ensure_ascii=False), flush=True)

        time.sleep(2)