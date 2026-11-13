// What's new: the reader's own changelog, newest first. WebReader has no
// release train: something worth telling goes out when it is ready, and
// gets an entry here. The version is the family's generation and the
// build; an entry may name just the generation.

import { t, resolve } from './i18n.js';

export const news = [
    {
        date: '2026-11-13',
        version: '1.8',
        title: {
            en: 'WebReader opens',
            ru: 'WebReader открыт',
            uk: 'WebReader відкрито',
            es: 'WebReader abre',
            fr: 'WebReader ouvre',
            de: 'WebReader ist da',
            'zh-Hans': 'WebReader 上线',
            ja: 'WebReader 公開',
        },
        text: {
            en: 'The family’s reader, now in the browser: the same page engine as the three apps, on any system. EPUB with notes and links, FB2, CBZ, Markdown, TXT and HTML, zipped or not. Palettes for day and night, four typefaces, up to four columns, frames and paper. Eight languages. It installs as an app and works offline. Books never leave your device.',
            ru: 'Читалка семейства теперь в браузере: тот же движок страницы, что в трёх приложениях, на любой системе. EPUB со сносками и ссылками, FB2, CBZ, Markdown, TXT и HTML, в ZIP или без. Палитры для дня и ночи, четыре шрифта, до четырёх колонок, рамки и бумага. Восемь языков. Ставится как приложение и работает без сети. Книги не покидают ваше устройство.',
            uk: 'Читалка родини тепер у браузері: той самий рушій сторінки, що в трьох застосунках, на будь-якій системі. EPUB зі зносками й посиланнями, FB2, CBZ, Markdown, TXT і HTML, у ZIP чи без. Палітри для дня й ночі, чотири шрифти, до чотирьох колонок, рамки й папір. Вісім мов. Встановлюється як застосунок і працює без мережі. Книги не залишають ваш пристрій.',
            es: 'El lector de la familia, ahora en el navegador: el mismo motor de página que las tres apps, en cualquier sistema. EPUB con notas y enlaces, FB2, CBZ, Markdown, TXT y HTML, en ZIP o sin él. Paletas para el día y la noche, cuatro tipografías, hasta cuatro columnas, marcos y papel. Ocho idiomas. Se instala como una app y funciona sin conexión. Los libros no salen de tu dispositivo.',
            fr: 'Le lecteur de la famille, désormais dans le navigateur : le même moteur de page que les trois apps, sur n’importe quel système. EPUB avec notes et liens, FB2, CBZ, Markdown, TXT et HTML, zippés ou non. Des palettes pour le jour et la nuit, quatre polices, jusqu’à quatre colonnes, cadres et papier. Huit langues. Il s’installe comme une app et fonctionne hors ligne. Les livres ne quittent pas votre appareil.',
            de: 'Der Reader der Familie, jetzt im Browser: dieselbe Seiten-Engine wie in den drei Apps, auf jedem System. EPUB mit Fußnoten und Links, FB2, CBZ, Markdown, TXT und HTML, gezippt oder nicht. Paletten für Tag und Nacht, vier Schriften, bis zu vier Spalten, Rahmen und Papier. Acht Sprachen. Lässt sich als App installieren und funktioniert offline. Die Bücher verlassen Ihr Gerät nicht.',
            'zh-Hans': '本系列的阅读器，现在可以在浏览器里使用：与三款 App 相同的页面引擎，任何系统都能用。支持带注释和链接的 EPUB、FB2、CBZ、Markdown、TXT 和 HTML，压缩或不压缩均可。日夜调色板、四种字体、最多四栏、边框和纸张。八种界面语言。可安装为应用，离线可用。书始终留在你的设备上。',
            ja: 'ファミリーのリーダーがブラウザで使えるようになりました。3 つのアプリと同じページエンジンが、どのシステムでも動きます。注釈とリンク付きの EPUB、FB2、CBZ、Markdown、TXT、HTML（ZIP でも可）。昼と夜のパレット、4 つの書体、最大 4 段組、枠と紙。8 つの言語。アプリとしてインストールでき、オフラインでも使えます。本はあなたのデバイスから出ません。',
        },
    },
];

/// The newest entry's date: what «seen» is measured against.
export const latest = news[0]?.date || '';

const element = (tag, attributes = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes)) {
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else node.setAttribute(key, value);
    }
    node.append(...children.filter(Boolean));
    return node;
};

export function renderNews(host, setting) {
    const language = resolve(setting);
    const pick = (words) => words[language] || words.en;
    const day = new Intl.DateTimeFormat(language, { day: 'numeric', month: 'long', year: 'numeric' });
    host.replaceChildren(
        element('a', { class: 'back', href: '#' }, '← ', t('Back')),
        element('p', { class: 'eyebrow', text: 'WebReader' }),
        element('h2', { text: t('What’s new') }),
        ...news.map((entry) => element('article', { class: 'entry' },
            element('p', { class: 'when', text: `${day.format(new Date(entry.date + 'T12:00:00'))} · ${entry.version}` }),
            element('h3', { text: pick(entry.title) }),
            element('p', { text: pick(entry.text) }))),
    );
}
