import sys
import json
import pyautogui
from PIL import Image
import pytesseract
from translate import Translator

# 设置Tesseract路径
pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'


def capture_and_translate(pos):

    target_lang='en'
    # 截图
    screenshot = pyautogui.screenshot()

    # OCR识别
    text = pytesseract.image_to_string(screenshot, lang='eng+chi_sim+jpn+kor')

    # 翻译 - 使用translate库
    translator = Translator(to_lang=target_lang)
    translated = translator.translate(text)

    return {
        'original_text': text,
        'translated_text': translated,
        'target_lang': target_lang
    }


if __name__ == '__main__':
    target_lang = sys.argv[1] if len(sys.argv) > 1 else 'en'
    result = capture_and_translate(target_lang)
    print(json.dumps(result))