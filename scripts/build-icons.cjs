/*
 * Sinh toàn bộ dấu hiệu Vyen RA NGOÀI app từ `brand/mark.json`:
 *   app/icon.svg          (Next tự phục vụ — tab trình duyệt)
 *   public/icons/*.png    (PWA: 180 / 192 / 512 + bản maskable)
 *   public/favicon.ico    (tab trình duyệt)
 *
 * Trước đây các file này được sinh tay rồi script bị xoá, nên chúng trôi khỏi
 * logo trong app: PNG mang màu `#11835F` — không thuộc bảng màu §2 và không khớp
 * bất kỳ màu nào trong `components/vyen-logo.tsx`. Chạy lại script này là cách
 * duy nhất để chúng không trôi lần nữa.
 *
 * Chạy:  npm run icons:build
 */
const fs = require('fs');
const path = require('path');
/*
 * KHÔNG require `sharp` ở đây — nó được require bên trong `build()`.
 *
 * File này export `markSvg` / `tiledSvg`, và `tests/brand-placement.test.ts`
 * import chúng để so byte `app/icon.svg` với bản sinh lúc này. `sharp` là binary
 * native theo nền tảng; require ở top-level khiến test mạnh nhất của repo nổ ngay
 * lúc import trên máy không có prebuilt binary — và nổ với lỗi không liên quan gì
 * tới logo. Chỉ `build()` mới thật sự cần tới nó.
 */

const ROOT = path.resolve(__dirname, '..');
const mark = require(path.join(ROOT, 'brand/mark.json'));
const P = mark.palette;
const F = mark.face;

/**
 * Gradient với toạ độ ẢNH, không phải theo bbox.
 *
 * Bắt buộc: hai vạch nối mắt là đường NẰM NGANG nên bbox của chúng cao bằng 0.
 * Gradient mặc định `objectBoundingBox` trên bbox rỗng không sinh ra gì — hai
 * vạch biến mất im lặng, phần còn lại vẫn đúng nên rất dễ lọt.
 */
const grad = (id, stops, box) =>
  `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" ${box}>${stops
    .map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`)
    .join('')}</linearGradient>`;

const DIAG = `x1="${mark.logoBox.x}" y1="${mark.logoBox.y}" x2="${
  mark.logoBox.x + mark.logoBox.w
}" y2="${mark.logoBox.y + mark.logoBox.h}"`;
const linkBox = (x1, x2) => `x1="${x1}" y1="${F.eyeY}" x2="${x2}" y2="${F.eyeY}"`;

/** Bản dựng SVG thô, không có ô bo — dùng cho favicon và các kích cỡ nhỏ. */
function markSvg(prefix = 'v') {
  const bands = mark.bands
    .map(
      (s, i) =>
        `<path d="${mark.cloud}" transform="translate(17 17) scale(${s}) translate(-17 -17)" fill="${
          mark.bandFills[i] === 'white' ? '#FFFFFF' : `url(#${prefix}-${mark.bandFills[i]})`
        }"/>`,
    )
    .join('\n    ');

  const face = `
    <path d="M ${F.leftEyeX} ${F.eyeY} H ${F.leftLinkEndX}" stroke="url(#${prefix}-linkL)" stroke-width="${F.linkWidth}" stroke-linecap="round" fill="none"/>
    <path d="M ${F.rightEyeX} ${F.eyeY} H ${F.rightLinkEndX}" stroke="url(#${prefix}-linkR)" stroke-width="${F.linkWidth}" stroke-linecap="round" fill="none"/>
    <circle cx="${F.leftEyeX}" cy="${F.eyeY}" r="${F.eyeR}" fill="url(#${prefix}-face)"/>
    <circle cx="${F.rightEyeX}" cy="${F.eyeY}" r="${F.eyeR}" fill="url(#${prefix}-face)"/>
    <path d="M ${F.mouthLeftX} ${F.mouthY} H ${F.mouthRightX}" stroke="${P.mouth}" stroke-width="${F.mouthWidth}" stroke-linecap="round" fill="none"/>
    <circle cx="${F.mouthLeftX}" cy="${F.mouthY}" r="${F.mouthDotR}" fill="${P.mouth}"/>
    <circle cx="${F.mouthRightX}" cy="${F.mouthY}" r="${F.mouthDotR}" fill="${P.mouth}"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${mark.viewBox} ${mark.viewBox}" fill="none">
  <defs>
    ${grad(`${prefix}-ring`, [['0', P.ringTop], ['1', P.ringBot]], DIAG)}
    ${grad(`${prefix}-green`, [['0', P.greenTop], ['1', P.greenBot]], DIAG)}
    ${grad(`${prefix}-mint`, [['0', P.mintTop], ['1', P.mintBot]], DIAG)}
    ${grad(`${prefix}-face`, [['0', P.faceTop], ['1', P.faceBot]], DIAG)}
    ${grad(`${prefix}-linkL`, [['0', P.linkEye], ['1', P.linkIn]], linkBox(F.leftEyeX, F.leftLinkEndX))}
    ${grad(`${prefix}-linkR`, [['0', P.linkEye], ['1', P.linkIn]], linkBox(F.rightEyeX, F.rightLinkEndX))}
  </defs>
  ${bands}
  ${face}
</svg>`;
}

/** Icon có ô bo trắng bo góc — dạng app icon trên màn hình chính. */
function tiledSvg() {
  const inner = markSvg('t').replace(/^[\s\S]*?<defs>/, '<defs>').replace('</svg>', '');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${mark.viewBox} ${mark.viewBox}" fill="none">
  <rect width="${mark.viewBox}" height="${mark.viewBox}" rx="7" fill="#FFFFFF"/>
  ${inner}
</svg>`;
}

const OUT = path.join(ROOT, 'public/icons');

/*
 * Export để `tests/brand-placement.test.ts` GỌI LẠI đúng hàm này rồi so với
 * file đã commit. Đó là cách duy nhất bắt được HÌNH trôi: so chuỗi rời rạc
 * (`contains(mark.cloud)`, đủ màu, số bản co) không thấy ra việc sửa
 * `mark.json` mà quên chạy lại script — vì `eyeR` chỉ là giá trị thuộc tính,
 * không xuất hiện dạng chữ để đối chiếu.
 */
async function build() {
  // Xem chú thích cạnh khai báo `fs`: require trễ để import `markSvg`/`tiledSvg`
  // không kéo theo binary native.
  const sharp = require('sharp');
  fs.mkdirSync(OUT, { recursive: true });
  const plain = Buffer.from(markSvg());
  const tiled = Buffer.from(tiledSvg());

  fs.writeFileSync(path.join(ROOT, 'app/icon.svg'), tiledSvg());
  console.log('app/icon.svg');

  const png = (buf, size, name) =>
    sharp(buf)
      .resize(size, size)
      .png()
      .toBuffer()
      .then((b) => fs.writeFileSync(path.join(OUT, name), b))
      .then(() => console.log('public/icons/' + name));

  // 180/192/512 CŨNG dùng bản có ô bo, khớp với `app/icon.svg`. Trước đây
  // icon.svg có ô bo còn PNG thì không — tức tab trình duyệt và icon cài trên
  // máy có hình khác nhau, đúng loại lệch mà đợt này xoá.
  const appIcon = Buffer.from(tiledSvg());
  await png(appIcon, 180, 'icon-180.png');
  await png(appIcon, 192, 'icon-192.png');
  await png(appIcon, 512, 'icon-512.png');

  // Maskable: logo phải nằm trong ~80% vùng an toàn, nền đặc để hệ cắt được.
  await sharp({
    create: { width: 512, height: 512, channels: 4, background: '#FFFFFF' },
  })
    .composite([{ input: await sharp(plain).resize(410, 410).png().toBuffer(), left: 51, top: 51 }])
    .png()
    .toBuffer()
    .then((b) => {
      fs.writeFileSync(path.join(OUT, 'maskable-512.png'), b);
      console.log('public/icons/maskable-512.png');
    });

  // favicon.ico nhúng PNG 16 + 32 (định dạng ICO cho phép nhúng PNG)
  const [i16, i32] = await Promise.all([
    sharp(plain).resize(16, 16).png().toBuffer(),
    sharp(plain).resize(32, 32).png().toBuffer(),
  ]);
  const header = Buffer.alloc(6 + 16 * 2);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(2, 4);
  [i16, i32].forEach((buf, i) => {
    const o = 6 + i * 16;
    const px = i === 0 ? 16 : 32;
    header[o] = px;
    header[o + 1] = px;
    header.writeUInt16LE(1, o + 4);
    header.writeUInt16LE(32, o + 6);
    header.writeUInt32LE(buf.length, o + 8);
    header.writeUInt32LE(header.length + buf.length, o + 12);
  });
  fs.writeFileSync(path.join(ROOT, 'public/favicon.ico'), Buffer.concat([header, i16, i32]));
  console.log('public/favicon.ico');
}

module.exports = { markSvg, tiledSvg, mark, build };

if (require.main === module) {
  build().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}