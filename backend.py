import sys
import json
import pyautogui
import re
from PIL import Image
import pytesseract
from translate import Translator
from pytesseract import Output

# 设置Tesseract路径
pytesseract.pytesseract.tesseract_cmd = r'.\tesseract\tesseract.exe'

# 设置语言包路径
import os
os.environ['TESSDATA_PREFIX'] = r'.\tessdata'

def detect_language(text):
    """检测文本语言（简体中文或英文）"""
    if re.search(r'[\u4e00-\u9fff]', text):  # 检测中文字符
        return 'zh'
    return 'en'


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
    original_text = pytesseract.image_to_string(screenshot1, lang='eng+chi_sim')

    # 检测语言并设置翻译方向
    lang = detect_language(original_text)
    if lang == 'zh':
        target_lang = 'en'
        from_lang = 'zh'
    else:
        target_lang = 'zh'
        from_lang = 'en'

    # 翻译文本
    translator = Translator(from_lang=from_lang, to_lang=target_lang)
    translated_text = translator.translate(original_text)

    # 获取pos2区域的OCR详细数据
    ocr_data = pytesseract.image_to_data(
        screenshot2,
        lang='eng+chi_sim',
        output_type=Output.DICT
    )

    # 在pos2区域查找匹配的文本位置
    matched_position = None
    min_required_length = 3  # 最小匹配字符长度

    for i in range(len(ocr_data['text'])):
        text = ocr_data['text'][i].strip()
        conf = int(ocr_data['conf'][i])

        # 检查置信度和文本长度
        if conf > 60 and len(text) >= min_required_length:
            # 检查是否在翻译文本中出现（忽略大小写）
            if text.lower() in translated_text.lower():
                matched_position = {
                    'x': ocr_data['left'][i] + pos2['x'],
                    'y': ocr_data['top'][i] + pos2['y'],
                    'width': ocr_data['width'][i],
                    'height': ocr_data['height'][i]
                }
                break

    return {
        'original_text': original_text,
        'translated_text': translated_text,
        'target_lang': target_lang,
        'matched_position': matched_position
    }


if __name__ == '__main__':
    # 解析命令行参数（两个位置区域）
    if len(sys.argv) < 2:
        raise ValueError('需要提供两个位置区域参数')

    result = capture_and_translate(eval(sys.argv[1])['pos1'], eval(sys.argv[1])['pos2'])
    print(json.dumps(result))