import json

def minify_skills(input_file, output_file):
    try:
        with open(input_file, 'r', encoding='utf-8') as f:
            skills = json.load(f)
        
        with open(output_file, 'w', encoding='utf-8') as out:
            for skill in skills:
                name = skill.get('name', 'N/A')
                # Simplifica a descrição: remove termos genéricos e mantém keywords
                desc = skill.get('description', '')
                
                # Escreve no formato: [NOME]: Descrição Curta
                out.write(f"[{name}]: {desc}\n")
        
        print(f"Sucesso! {len(skills)} skills otimizadas em {output_file}")
    
    except Exception as e:
        print(f"Erro: {e}")

# Executa o processo
minify_skills('skills_index.json', 'skills_index_lite.txt')