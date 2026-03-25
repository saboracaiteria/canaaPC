const fs = require('fs');

try {
    const content = fs.readFileSync('INSTRUCOES.txt', 'utf8');

    const stylePattern = /<style>([\s\S]*?)<\/style>/i;
    const scriptPattern = /<script type="module">([\s\S]*?)<\/script>/i;

    let newContent = content;

    const styleMatch = newContent.match(stylePattern);
    if (styleMatch) {
        fs.writeFileSync('styles.css', styleMatch[1].trim(), 'utf8');
        newContent = newContent.replace(stylePattern, '<link rel="stylesheet" href="styles.css">');
    }

    const scriptMatch = newContent.match(scriptPattern);
    if (scriptMatch) {
        if (!fs.existsSync('js')){
            fs.mkdirSync('js');
        }
        fs.writeFileSync('js/main.js', scriptMatch[1].trim(), 'utf8');
        newContent = newContent.replace(scriptPattern, '<script type="module" src="js/main.js"></script>');
    }

    fs.writeFileSync('index.html', newContent, 'utf8');
    
    // Rename original file to a backup
    fs.renameSync('INSTRUCOES.txt', 'INSTRUCOES.bkp.txt');
    
    console.log('Files successfully split with Node.js');
} catch (e) {
    console.error('Error during split:', e);
}
