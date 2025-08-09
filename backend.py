import sys
import json
import time
import pyautogui
import re
from PIL import Image
import pytesseract
from deep_translator import PonsTranslator
from pytesseract import Output

# 设置UTF-8编码输出
import os
os.environ['PYTHONIOENCODING'] = 'utf-8'

# 设置控制台编码
if sys.platform.startswith('win'):
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.detach())
    sys.stderr = codecs.getwriter('utf-8')(sys.stderr.detach())

# 设置Tesseract路径
pytesseract.pytesseract.tesseract_cmd = r'.\tesseract\tesseract.exe'

# 设置语言包路径
import os

os.environ['TESSDATA_PREFIX'] = r'.\tessdata'

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
        return 'zh-CN'
    return 'en-GB'


def preprocess_text(text):
    """预处理文本：移除标点、空格，统一为小写"""
    text = re.sub(r'[^\w\u4e00-\u9fff]', '', text)  # 保留字母数字和中文字符
    return text.lower()


def capture_and_translate(pos1, pos2):
    # 截取pos1区域
    screenshot1 = pyautogui.screenshot(region=(
        pos1['x'],
        pos1['y'],
        pos1['width'],
        pos1['height']
    ))

    # 截取pos2区域
    screenshot2 = pyautogui.screenshot(region=(
        pos2['x'],
        pos2['y'],
        pos2['width'],
        pos2['height']
    ))

    # OCR识别pos1区域的文本
    original_text = pytesseract.image_to_string(screenshot1, lang='eng+chi_sim').strip()

    # 检测语言并设置翻译方向
    lang = detect_language(original_text)
    if lang == 'zh-CN':
        target_lang = 'en'
        from_lang = 'zh-cn'
    else:
        target_lang = 'zh-cn'
        from_lang = 'en'

    # 翻译文本
    translator = PonsTranslator(source=from_lang, target=target_lang)
    translated_text = translator.translate(original_text)

    # 获取pos2区域的OCR详细数据
    ocr_data = pytesseract.image_to_data(
        screenshot2,
        lang='eng+chi_sim',
        output_type=Output.DICT
    )

    # 预处理翻译文本
    processed_translated = preprocess_text(translated_text)

    # 在pos2区域查找匹配的文本位置
    matched_position = None
    min_required_length = 1  # 降低最小匹配字符长度以适应中文
    max_lcs = -1
    ocr_data['translate_text'] = ['']*len(ocr_data['text'])

    for i in range(len(ocr_data['text'])):
        text = ocr_data['text'][i].strip()
        conf = int(ocr_data['conf'][i])

        # 检查置信度和文本长度
        if conf >= 60 and len(text) >= min_required_length:
            processed_text = preprocess_text(text)
            ocr_data['translate_text'][i] = processed_text

            lcs = longest_common_substring(processed_text, processed_translated)
            # 检查是否在翻译文本中出现（忽略大小写和标点）
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
        'translated_text': translated_text,
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
            result = capture_and_translate(eval(sys.argv[1])['pos1'], eval(sys.argv[1])['pos2'])
            # 确保输出完整的JSON，添加换行符
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
        
        time.sleep(0.5)