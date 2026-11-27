import { readFile, writeFile } from 'node:fs/promises';

const packages = [
  'react', 'react-dom', 'scheduler', 'lucide-react',
  '@fontsource/ibm-plex-sans', '@fontsource/ibm-plex-mono', '@fontsource/cormorant-garamond',
];
const notices = await Promise.all(packages.map(async name => {
  const license = await readFile(new URL(`../node_modules/${name}/LICENSE`, import.meta.url), 'utf8');
  return `${name}\n${license.trim()}`;
}));
const inkLicense = await readFile(new URL('../src/shared/assets/MarckScript-OFL.txt', import.meta.url), 'utf8');
notices.push(`Marck Script
${inkLicense.trim()}`);
const output = new URL('../dist/index.html', import.meta.url);
const html = await readFile(output, 'utf8');
notices.push('SRD 5.1: This prototype adapts material from the System Reference Document 5.1 by Wizards of the Coast LLC.\nSource: https://dnd.wizards.com/resources/systems-reference-document\nLicense: Creative Commons Attribution 4.0 International, https://creativecommons.org/licenses/by/4.0/legalcode.');
const comment = notices.join('\n\n').replaceAll('--', '—');
await writeFile(output, `${html}\n<!-- Лицензии встроенных зависимостей\n${comment}\n-->\n`);
