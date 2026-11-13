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
            en: 'PDF, as printed',
            ru: 'PDF как напечатан',
            uk: 'PDF як надруковано',
            es: 'PDF, tal como se imprimió',
            fr: 'Le PDF, tel qu’imprimé',
            de: 'PDF, wie gedruckt',
            'zh-Hans': 'PDF，保持原样排版',
            ja: 'PDF を印刷どおりに',
        },
        text: {
            en: 'A PDF opens page by page, laid out as it was printed. Pages of text take your palette’s colours, by day and by night; pictures keep their own. The contents come from the PDF itself. The first PDF needs the network once.',
            ru: 'PDF открывается страницами, как его сверстали. Страницы с текстом берут цвета вашей палитры, днём и ночью, картинки остаются своими. Оглавление берётся из самого PDF. Первому PDF один раз нужна сеть.',
            uk: 'PDF відкривається сторінками, як його зверстали. Сторінки з текстом беруть кольори вашої палітри, удень і вночі, зображення лишаються своїми. Зміст береться з самого PDF. Першому PDF один раз потрібна мережа.',
            es: 'Un PDF se abre página a página, tal como se maquetó. Las páginas de texto toman los colores de tu paleta, de día y de noche; las imágenes conservan los suyos. El índice sale del propio PDF. El primer PDF necesita conexión una vez.',
            fr: 'Un PDF s’ouvre page par page, tel qu’il a été mis en page. Les pages de texte prennent les couleurs de votre palette, le jour comme la nuit ; les images gardent les leurs. La table des matières vient du PDF lui-même. Le premier PDF a besoin du réseau une fois.',
            de: 'Ein PDF öffnet sich Seite für Seite, so wie es gesetzt wurde. Textseiten nehmen die Farben Ihrer Palette an, bei Tag und bei Nacht; Bilder behalten ihre eigenen. Das Inhaltsverzeichnis kommt aus dem PDF selbst. Das erste PDF braucht einmal das Netz.',
            'zh-Hans': 'PDF 按页打开，保持原有排版。文字页使用你的调色板颜色，白天和夜晚都是；图片保持原色。目录取自 PDF 本身。第一次打开 PDF 时需要联网一次。',
            ja: 'PDF はページごとに、組まれたとおりに開きます。文字のページは昼も夜もパレットの色に、画像は元の色のままです。目次は PDF 自身のものを使います。最初の PDF だけ、一度ネット接続が必要です。',
        },
    },
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

/// What «seen» is measured against: the newest entry's date and the count,
/// so a second entry on the same day is news too.
export const latest = news.length ? `${news[0].date}.${news.length}` : '';

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
