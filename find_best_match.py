import sys
import json
from translate import Translator

# 翻译API配置 - 静态设置
TRANSLATION_CONFIG = {
    'provider': 'default',  # 可选: 'default', 'mymemory', 'libre', 'google'
    'api_key': None,        # 如果需要API密钥
    'base_url': None,       # 自定义API基础URL
    'from_lang': 'zh',      # 源语言
    'to_lang': 'en'         # 目标语言
}

def get_translator():
    """根据配置获取翻译器实例"""
    config = TRANSLATION_CONFIG
    
    if config['provider'] == 'google' and config['api_key']:
        return Translator(
            from_lang=config['from_lang'], 
            to_lang=config['to_lang'], 
            provider='google', 
            api_key=config['api_key']
        )
    elif config['provider'] == 'mymemory':
        return Translator(
            from_lang=config['from_lang'], 
            to_lang=config['to_lang'], 
            provider='mymemory'
        )
    elif config['provider'] == 'libre':
        return Translator(
            from_lang=config['from_lang'], 
            to_lang=config['to_lang'], 
            provider='libre'
        )
    else:
        return Translator(
            from_lang=config['from_lang'], 
            to_lang=config['to_lang']
        )

def find_best_match(chinese_text, english_options):
    """
    给定中文文本和英文选项列表，找出意思最相近的选项
    """
    try:
        # 将中文翻译成英文
        translator = get_translator()
        translated_text = translator.translate(chinese_text.strip()).lower()
        
        best_match = None
        highest_score = 0
        
        for option in english_options:
            option_lower = option.strip().lower()
            score = 0
            
            # 计算匹配得分
            # 1. 完全匹配
            if translated_text == option_lower:
                score = 100
            
            # 2. 包含匹配
            elif translated_text in option_lower or option_lower in translated_text:
                score = 80
            
            # 3. 单词匹配
            else:
                translated_words = translated_text.split()
                option_words = option_lower.split()
                
                matches = 0
                for word in translated_words:
                    if len(word) > 2:  # 忽略短词
                        for opt_word in option_words:
                            if word in opt_word or opt_word in word:
                                matches += 1
                                break
                
                if matches > 0:
                    score = (matches / len(translated_words)) * 60
            
            # 更新最佳匹配
            if score > highest_score:
                highest_score = score
                best_match = option
        
        return {
            'chinese_text': chinese_text,
            'translated_text': translated_text,
            'best_match': best_match,
            'confidence': highest_score,
            'all_options': english_options
        }
        
    except Exception as e:
        return {
            'chinese_text': chinese_text,
            'translated_text': '',
            'best_match': english_options[0] if english_options else None,
            'confidence': 0,
            'all_options': english_options,
            'error': str(e)
        }

if __name__ == '__main__':
    # 设置UTF-8编码
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    
    if len(sys.argv) < 3:
        print(json.dumps({'error': '需要提供中文文本和英文选项'}, ensure_ascii=False))
        sys.exit(1)
    
    chinese_text = sys.argv[1]
    english_options = sys.argv[2].split(',')
    
    result = find_best_match(chinese_text, english_options)
    print(json.dumps(result, ensure_ascii=False, indent=2))