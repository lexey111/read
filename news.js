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
            en: 'MOBI and AZW3',
            ru: 'MOBI и AZW3',
            uk: 'MOBI і AZW3',
            es: 'MOBI y AZW3',
            fr: 'MOBI et AZW3',
            de: 'MOBI und AZW3',
            'zh-Hans': 'MOBI 和 AZW3',
            ja: 'MOBI と AZW3',
        },
        text: {
            en: 'Kindle books open too: MOBI, AZW3 and the files that carry both, with their contents, pictures and links. A book locked with DRM cannot be opened, and the reader says so.',
            ru: 'Открываются и книги Kindle: MOBI, AZW3 и файлы, где есть оба формата, с оглавлением, картинками и ссылками. Книгу под DRM открыть нельзя, читалка так и скажет.',
            uk: 'Відкриваються й книги Kindle: MOBI, AZW3 і файли, де є обидва формати, зі змістом, картинками й посиланнями. Книгу під DRM відкрити не можна, читалка так і скаже.',
            es: 'También se abren los libros de Kindle: MOBI, AZW3 y los archivos que llevan ambos, con su índice, sus imágenes y sus enlaces. Un libro con DRM no se puede abrir, y el lector lo dice.',
            fr: 'Les livres Kindle s’ouvrent aussi : MOBI, AZW3 et les fichiers qui portent les deux, avec leur table, leurs images et leurs liens. Un livre sous DRM ne peut pas s’ouvrir, et le lecteur le dit.',
            de: 'Auch Kindle-Bücher öffnen sich: MOBI, AZW3 und Dateien mit beidem, mit Inhaltsverzeichnis, Bildern und Links. Ein Buch mit DRM lässt sich nicht öffnen, und der Reader sagt das.',
            'zh-Hans': 'Kindle 图书也能打开了：MOBI、AZW3 以及同时包含两者的文件，目录、图片和链接都保留。带 DRM 的图书无法打开，阅读器会说明。',
            ja: 'Kindle の本も開けるようになりました。MOBI、AZW3、両方を含むファイルに対応し、目次・画像・リンクもそのままです。DRM で保護された本は開けず、その旨を表示します。',
        },
    },
    {
        date: '2026-11-13',
        version: '1.8',
        title: {
            en: 'A PDF reads as a book',
            ru: 'PDF читается как книга',
            uk: 'PDF читається як книга',
            es: 'Un PDF se lee como un libro',
            fr: 'Un PDF se lit comme un livre',
            de: 'Ein PDF liest sich wie ein Buch',
            'zh-Hans': 'PDF 像书一样阅读',
            ja: 'PDF を本のように',
        },
        text: {
            en: 'A PDF with a text layer can now be read as text: your typeface, size, columns and palette, the chapters from its headings or its own contents. Running headers go, footnotes come after their page, verses keep their lines. When such a PDF opens, the reader asks how to read it: text suits a book, pictures a form or a magazine. The choice can be changed in the settings, under Read as. A scan opens as pictures.',
            ru: 'PDF с текстовым слоем теперь можно читать текстом: ваш шрифт, размер, колонки и палитра, главы из его заголовков или собственного оглавления. Колонтитулы убираются, сноски идут после своей страницы, стихи сохраняют строки. Открывая такой PDF, читалка спрашивает, как его читать: книге подходит текст, бланку или журналу картинки. Выбор можно поменять в настройках, в «Читать как». Скан открывается картинками.',
            uk: 'PDF із текстовим шаром тепер можна читати текстом: ваш шрифт, розмір, колонки й палітра, розділи з його заголовків або власного змісту. Колонтитули зникають, зноски йдуть після своєї сторінки, вірші зберігають рядки. Відкриваючи такий PDF, читалка питає, як його читати: книзі пасує текст, бланку чи журналу картинки. Вибір можна змінити в налаштуваннях, у «Читати як». Скан відкривається картинками.',
            es: 'Un PDF con capa de texto ahora se puede leer como texto: tu tipografía, tamaño, columnas y paleta, los capítulos de sus títulos o de su propio índice. Los encabezados repetidos desaparecen, las notas van tras su página, los versos conservan sus líneas. Al abrir un PDF así, el lector pregunta cómo leerlo: un libro va bien como texto, un formulario o una revista como imágenes. Se puede cambiar en los ajustes, en Leer como. Un escaneo se abre como imágenes.',
            fr: 'Un PDF avec une couche de texte peut désormais se lire en texte : votre police, sa taille, vos colonnes et votre palette, les chapitres tirés de ses titres ou de sa propre table. Les en-têtes courants disparaissent, les notes suivent leur page, les vers gardent leurs lignes. À l’ouverture d’un tel PDF, le lecteur demande comment le lire : un livre en texte, un formulaire ou un magazine en images. Le choix se change dans les réglages, sous Lire comme. Un scan s’ouvre en images.',
            de: 'Ein PDF mit Textebene lässt sich jetzt als Text lesen: Ihre Schrift, Größe, Spalten und Palette, die Kapitel aus seinen Überschriften oder seinem eigenen Inhaltsverzeichnis. Kolumnentitel verschwinden, Fußnoten folgen ihrer Seite, Verse behalten ihre Zeilen. Beim Öffnen eines solchen PDFs fragt der Reader, wie es gelesen werden soll: ein Buch als Text, ein Formular oder eine Zeitschrift als Bilder. Die Wahl lässt sich in den Einstellungen unter Lesen als ändern. Ein Scan öffnet sich als Bilder.',
            'zh-Hans': '带文字层的 PDF 现在可以按文本阅读：使用你的字体、字号、分栏和调色板，章节取自其标题或自带目录。页眉页脚会去掉，脚注放在所在页之后，诗句保留分行。打开这样的 PDF 时，阅读器会询问阅读方式：书籍适合文本，表单或杂志适合图片。之后可在设置的“阅读方式”中更改。扫描件以图片打开。',
            ja: 'テキストのある PDF を、テキストとして読めるようになりました。書体、サイズ、段組み、パレットはあなたの設定どおり、章は見出しか PDF 自身の目次から。柱は取り除き、脚注はそのページの後に、詩は行を保ちます。そのような PDF を開くと、読み方を尋ねます。本はテキスト、書類や雑誌は画像が向いています。設定の「読み方」でいつでも変更できます。スキャンは画像として開きます。',
        },
    },
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
