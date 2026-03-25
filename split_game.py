import re

with open('INSTRUCOES.txt', 'r', encoding='utf-8') as f:
    content = f.read()

# Match style block
style_pattern = re.compile(r'<style>(.*?)</style>', re.DOTALL)
style_match = style_pattern.search(content)

if style_match:
    style_content = style_match.group(1)
    with open('styles.css', 'w', encoding='utf-8') as f:
        f.write(style_content.strip())
    content = style_pattern.sub('<link rel="stylesheet" href="styles.css">', content)

# Match script module block
script_pattern = re.compile(r'<script type="module">(.*?)</script>', re.DOTALL)
script_match = script_pattern.search(content)

if script_match:
    script_content = script_match.group(1)
    with open('js/main.js', 'w', encoding='utf-8') as f:
        f.write(script_content.strip())
    content = script_pattern.sub('<script type="module" src="js/main.js"></script>', content)

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("Files successfully split.")
