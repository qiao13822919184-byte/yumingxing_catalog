import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { InquiryItem, Product, SiteSettings } from './catalog-types';
import {
  buildWhatsAppInquiry, createInquiryCsv, createInquiryPdf, downloadInquiryFile,
  validateInquiry, whatsappNumber,
} from './inquiry-export';

type Props = {
  open: boolean;
  onClose: () => void;
  items: InquiryItem[];
  setItems: (items: InquiryItem[]) => void;
  products: Product[];
  settings: SiteSettings;
  lang: 'en' | 'zh';
};

const COPY = {
  en: {
    title: 'Your inquiry list', close: 'Close inquiry list', count: 'selected products',
    intro: 'Add quantities and notes, then save your list or contact our sales team.',
    local: 'This list is saved only in this browser’s local storage. Clearing browser data removes it; it does not sync to other devices.',
    empty: 'Your inquiry list is empty.', browse: 'Continue browsing', remove: 'Remove',
    original: 'Original code', model: 'Model', quantity: 'Requested quantity', note: 'Notes / requirements',
    quantityPlaceholder: 'e.g. 500 sets / 20 cartons', notePlaceholder: 'Material, packaging, delivery needs…',
    csv: 'Download CSV', pdf: 'Generate & download PDF', readyPdf: 'Download PDF',
    share: 'Share PDF via device', preview: 'Preview PDF', whatsapp: 'WhatsApp (text)', working: 'Generating PDF…',
    shareHint: 'Generate the PDF first. On supported phones, the share button opens the system share sheet; otherwise it downloads the file.',
    attachmentHint: 'WhatsApp opens a text draft for you to review and send. PDF / CSV attachments must be selected manually in WhatsApp; no file is sent automatically.',
    csvReady: 'CSV download requested. Open the file with Excel or another spreadsheet app.',
    pdfReady: 'PDF is ready and its download was requested. You can now share this file.',
    downloaded: 'PDF download requested. Attach the downloaded file manually when contacting sales.',
    shareFallback: 'File sharing is unavailable in this browser. PDF download requested; attach the file manually in WhatsApp.',
    shareCancelled: 'Sharing cancelled. Your PDF is still ready to download or share.',
    shareComplete: 'The system share action completed. Check the selected app to confirm delivery.',
    shareFailed: 'System sharing could not complete. You can still download the PDF and attach it manually.',
    blocked: 'Remove the flagged items before downloading, sharing or opening WhatsApp. Add the updated product again from the catalog if needed.',
    missing: 'This product is no longer available in the catalog.',
    unpublished: 'This product has been unpublished.',
    'sku-changed': 'This product’s SKU has changed. Remove this entry and add it again from the catalog.',
    duplicate: 'This SKU or product is duplicated. Remove this entry; contact sales if the catalog contains duplicate SKUs.',
    'invalid-sku': 'This product does not have a valid SKU.',
    longText: 'This selection exceeds a reliable WhatsApp text-link length. Download the full CSV or PDF first, then open WhatsApp below and attach that file. The draft below contains a short introduction only; product lines are in your exported file.',
    attachWhatsApp: 'Open WhatsApp to attach the file',
    invalidNumber: 'The sales WhatsApp number must include a valid country code. Downloads remain available.',
    savedSku: 'Saved SKU', error: 'The export could not be completed. Please try again.',
    updated: 'Your selection changed. Generate a fresh PDF before sharing.',
    imageUnavailable: 'Image unavailable', generatingPage: 'Rendering page',
  },
  zh: {
    title: '我的产品了解清单', close: '关闭了解清单', count: '款已选产品',
    intro: '填写意向数量与备注，保存清单或联系销售进一步了解。',
    local: '清单仅保存在当前浏览器的本地记录中。清除浏览器数据后会消失，不会自动同步到其他设备。',
    empty: '了解清单还是空的。', browse: '继续选品', remove: '移除',
    original: '原货号', model: '型号', quantity: '意向数量', note: '备注 / 具体需求',
    quantityPlaceholder: '例如：500 套 / 20 箱', notePlaceholder: '材质、包装、交货等需求…',
    csv: '下载 CSV 表格', pdf: '生成并下载 PDF', readyPdf: '下载 PDF',
    share: '系统分享 PDF', preview: '预览 PDF', whatsapp: 'WhatsApp（文本）', working: '正在生成 PDF…',
    shareHint: '请先生成 PDF。支持文件分享的手机会打开系统分享面板；其他浏览器会下载文件。',
    attachmentHint: 'WhatsApp 会打开文本草稿，由您检查并发送。PDF / CSV 附件需要您在 WhatsApp 中手动选择，系统不会自动发送文件。',
    csvReady: '已请求下载 CSV，可用 Excel 或其他表格软件打开。',
    pdfReady: 'PDF 已生成并请求下载，现在可以分享该文件。',
    downloaded: '已请求下载 PDF，联系销售时请手动附上下载的文件。',
    shareFallback: '当前浏览器不支持文件分享，已请求下载 PDF；请在 WhatsApp 中手动添加附件。',
    shareCancelled: '已取消分享，PDF 仍可下载或再次分享。',
    shareComplete: '系统分享操作已完成，请到所选应用中确认是否送达。',
    shareFailed: '系统分享未能完成，您仍可下载 PDF 并手动添加附件。',
    blocked: '请先移除标记的条目，再下载、分享或打开 WhatsApp。如需了解该产品，可从图册重新加入更新后的条目。',
    missing: '该产品已不在图册中。', unpublished: '该产品已下架。',
    'sku-changed': '该产品的 SKU 已变更，请移除此条目后从图册重新加入。',
    duplicate: '此 SKU 或产品存在重复，请移除此条目；如图册中的 SKU 重复，请联系销售。',
    'invalid-sku': '该产品缺少有效 SKU。',
    longText: '当前清单超过适合 WhatsApp 链接的文本长度。请先下载完整 CSV 或 PDF，再通过下方入口打开 WhatsApp 并手动添加附件。下方入口仅预填简短说明，完整选品信息保留在导出文件中。',
    attachWhatsApp: '打开 WhatsApp 并手动添加附件',
    invalidNumber: '销售 WhatsApp 号码需要包含有效国家区号；您仍可下载清单。',
    savedSku: '加入时 SKU', error: '导出未能完成，请重试。',
    updated: '清单已变更，分享前请重新生成 PDF。',
    imageUnavailable: '图片暂不可用', generatingPage: '正在生成页面',
  },
};

export function InquiryPanel({ open, onClose, items, setItems, products, settings, lang }: Props) {
  const copy = COPY[lang];
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const generationRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const headingId = useId();
  const infoId = useId();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [pdf, setPdf] = useState<{ signature: string; file: File } | null>(null);
  const [pdfPreview, setPdfPreview] = useState<{ file: File; url: string } | null>(null);
  const [longWhatsApp, setLongWhatsApp] = useState(false);
  const validation = useMemo(() => validateInquiry(items, products), [items, products]);
  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const issueByIndex = useMemo(() => new Map(validation.issues.map((issue) => [issue.index, issue.reason])), [validation]);
  const blocked = !items.length || validation.issues.length > 0;
  // Including the full selected product records invalidates old files after an admin edit.
  const signature = JSON.stringify({ items, products: items.map((item) => productById.get(item.id) || null), brand: settings.brand, whatsapp: settings.whatsapp });
  const activePdf = pdf?.signature === signature ? pdf.file : null;
  const previousSignature = useRef(signature);
  const phoneIsValid = Boolean(whatsappNumber(settings.whatsapp));
  const whatsapp = useMemo(() => {
    if (blocked || !phoneIsValid) return null;
    try { return buildWhatsAppInquiry(items, products, settings, lang); } catch { return null; }
  }, [blocked, phoneIsValid, items, products, settings, lang]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; generationRef.current?.abort(); };
  }, []);

  useEffect(() => {
    if (!activePdf) { setPdfPreview(null); return; }
    const url = URL.createObjectURL(activePdf);
    setPdfPreview({ file: activePdf, url });
    return () => { URL.revokeObjectURL(url); };
  }, [activePdf]);

  useEffect(() => {
    if (previousSignature.current === signature) return;
    previousSignature.current = signature;
    generationRef.current?.abort();
    generationRef.current = null;
    setBusy(false);
    setProgress(null);
    setPdf(null);
    setLongWhatsApp(false);
    setStatus('');
  }, [signature]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!open) {
      if (dialog.open) dialog.close();
      return;
    }
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    if (!dialog.open) dialog.showModal();
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [open]);

  function updateItem(index: number, field: 'quantity' | 'note', value: string) {
    setItems(items.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item));
  }

  function downloadCsv() {
    if (blocked) return;
    try {
      downloadInquiryFile(createInquiryCsv(items, products, settings));
      setStatus(copy.csvReady);
    } catch (error) { setStatus(error instanceof Error ? error.message : copy.error); }
  }

  async function generateOrDownloadPdf() {
    if (blocked || busy) return;
    if (activePdf) { downloadInquiryFile(activePdf); setStatus(copy.downloaded); return; }
    const controller = new AbortController();
    generationRef.current?.abort();
    generationRef.current = controller;
    setBusy(true);
    setStatus(copy.working);
    setProgress(null);
    try {
      const file = await createInquiryPdf(items, products, settings, {
        signal: controller.signal,
        onProgress: (done, total) => {
          if (!controller.signal.aborted && mountedRef.current) setProgress({ done, total });
        },
      });
      if (controller.signal.aborted || !mountedRef.current) return;
      setPdf({ signature, file });
      downloadInquiryFile(file);
      setStatus(copy.pdfReady);
    } catch (error) {
      if (!controller.signal.aborted && mountedRef.current) setStatus(error instanceof Error ? error.message : copy.error);
    } finally {
      if (generationRef.current === controller && mountedRef.current) {
        generationRef.current = null;
        setBusy(false);
        setProgress(null);
      }
    }
  }

  function sharePdf() {
    if (!activePdf || blocked || busy) return;
    const payload: ShareData = { files: [activePdf], title: `${settings.brand} · Product inquiry / 产品了解清单` };
    try {
      if (typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [activePdf] })) {
        // The File already exists. Calling share here preserves the original user gesture.
        void navigator.share(payload).then(() => {
          if (mountedRef.current) setStatus(copy.shareComplete);
        }).catch((error: unknown) => {
          if (!mountedRef.current) return;
          setStatus(error instanceof Error && error.name === 'AbortError' ? copy.shareCancelled : copy.shareFailed);
        });
        return;
      }
      downloadInquiryFile(activePdf);
      setStatus(copy.shareFallback);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') { setStatus(copy.shareCancelled); return; }
      downloadInquiryFile(activePdf);
      setStatus(copy.shareFallback);
    }
  }

  function openWhatsApp() {
    if (!whatsapp || blocked) return;
    if (whatsapp.tooLong) { setLongWhatsApp(true); setStatus(copy.longText); return; }
    window.open(whatsapp.url, '_blank', 'noopener,noreferrer');
    setStatus(copy.attachmentHint);
  }

  return (
    <dialog ref={dialogRef} className="inquiry-dialog" aria-labelledby={headingId} aria-describedby={infoId}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClose={(event) => { if (open && !event.currentTarget.open) onClose(); }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
      }}>
      <style>{PANEL_STYLES}</style>
      <div className="inquiry-inner">
        <div className="inquiry-heading">
          <div><p className="eyebrow">{items.length} {copy.count}</p><h2 id={headingId}>{copy.title}</h2></div>
          <button ref={closeRef} className="close inquiry-close" onClick={onClose} aria-label={copy.close}>×</button>
        </div>
        <p id={infoId} className="muted">{copy.intro}</p>
        <p className="detail-note inquiry-local-note">{copy.local}</p>
        {items.length === 0 ? <div className="empty-state"><p>{copy.empty}</p><button className="primary" onClick={onClose}>{copy.browse}</button></div> : <>
          {validation.issues.length > 0 && <p className="inquiry-warning" role="alert">{copy.blocked}</p>}
          <div className="inquiry-items">
            {items.map((item, index) => {
              const product = productById.get(item.id);
              const issue = issueByIndex.get(index);
              const inputPrefix = `${headingId}-${index}`;
              return <article className={`inquiry-item${issue ? ' inquiry-item-unavailable' : ''}`} key={`${item.id}-${index}`}>
                <div className="inquiry-product-summary">
                  {product?.image ? <img className="inquiry-thumbnail" src={product.image} alt={lang === 'zh' ? product.nameZh : product.nameEn} loading="lazy" onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }} /> : <div className="inquiry-thumbnail inquiry-no-image" aria-label={copy.imageUnavailable}>—</div>}
                  <div className="inquiry-product-identity">
                    <strong className="inquiry-sku">SKU: {product?.sku || item.sku || '—'}</strong>
                    {product && <><h3>{lang === 'zh' ? product.nameZh : product.nameEn}</h3><p className="muted inquiry-second-name">{lang === 'zh' ? product.nameEn : product.nameZh}</p><p className="inquiry-codes">{copy.original}: {product.catalogId || '—'} · {copy.model}: {product.model || '—'}</p></>}
                    {issue && <p className="inquiry-warning inquiry-item-warning">{copy[issue]}{issue === 'sku-changed' && <span> {copy.savedSku}: {item.sku}</span>}</p>}
                  </div>
                  <button className="inquiry-remove" onClick={() => setItems(items.filter((_, itemIndex) => itemIndex !== index))} aria-label={`${copy.remove} ${item.sku}`}>{copy.remove}</button>
                </div>
                <div className="inquiry-inputs">
                  <label htmlFor={`${inputPrefix}-quantity`}>{copy.quantity}<input id={`${inputPrefix}-quantity`} type="text" value={item.quantity} onChange={(event) => updateItem(index, 'quantity', event.target.value)} placeholder={copy.quantityPlaceholder} disabled={Boolean(issue)} /></label>
                  <label htmlFor={`${inputPrefix}-note`}>{copy.note}<textarea id={`${inputPrefix}-note`} rows={2} value={item.note} onChange={(event) => updateItem(index, 'note', event.target.value)} placeholder={copy.notePlaceholder} disabled={Boolean(issue)} /></label>
                </div>
              </article>;
            })}
          </div>
          <div className="inquiry-export-area">
            <div className="export-actions">
              <button className="secondary" onClick={downloadCsv} disabled={blocked}>{copy.csv}</button>
              <button className="primary" onClick={() => { void generateOrDownloadPdf(); }} disabled={blocked || busy}>{busy ? copy.working : activePdf ? copy.readyPdf : copy.pdf}</button>
              <button className="secondary share-file" onClick={sharePdf} disabled={!activePdf || blocked || busy} title={!activePdf ? copy.shareHint : undefined}>{copy.share}</button>
              <button className="whatsapp-button" onClick={openWhatsApp} disabled={blocked || !phoneIsValid}>{copy.whatsapp}</button>
            </div>
            {activePdf && pdfPreview?.file === activePdf && <a className="inquiry-preview" href={pdfPreview.url} target="_blank" rel="noopener noreferrer">{copy.preview} ↗</a>}
            {busy && progress && <div className="inquiry-progress"><progress value={progress.done} max={progress.total} aria-label={copy.working} /><span>{copy.generatingPage} {progress.done} / {progress.total}</span></div>}
            <p className="export-status" role="status" aria-live="polite" aria-atomic="true">{status}</p>
            {!phoneIsValid && <p className="inquiry-warning">{copy.invalidNumber}</p>}
            {longWhatsApp && whatsapp && !blocked && <div className="inquiry-long-whatsapp"><p>{copy.longText}</p><a className="whatsapp-button" href={whatsapp.attachmentUrl} target="_blank" rel="noopener noreferrer">{copy.attachWhatsApp}</a></div>}
            <p className="detail-note">{copy.shareHint}</p>
            <p className="detail-note">{copy.attachmentHint}</p>
            <button className="inquiry-continue" onClick={onClose}>{copy.browse} →</button>
          </div>
        </>}
      </div>
    </dialog>
  );
}

const PANEL_STYLES = `
.inquiry-dialog{width:min(900px,calc(100% - 24px));max-width:none;max-height:calc(100dvh - 32px);padding:0;margin:auto;border:1px solid #d8dfd8;border-radius:20px;background:#fffdf7;color:#183b39;box-shadow:0 30px 100px #102c3855;overflow:hidden}
.inquiry-dialog::backdrop{background:#082827aa;backdrop-filter:blur(5px)}
.inquiry-dialog .inquiry-inner{padding:28px;max-height:calc(100dvh - 34px);overflow:auto;overscroll-behavior:contain;box-sizing:border-box}
.inquiry-dialog .inquiry-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:12px}.inquiry-dialog .inquiry-heading h2{margin:3px 0;font-size:clamp(24px,4vw,34px);line-height:1.2}.inquiry-dialog .eyebrow{margin:0;font-size:11px;letter-spacing:.14em;text-transform:uppercase}.inquiry-dialog .muted{color:#627572;font-size:14px;line-height:1.6}
.inquiry-dialog .inquiry-close{position:static;flex:0 0 40px;width:40px;height:40px;padding:0;border:1px solid #d5dfd6;border-radius:50%;background:#fff;color:#183b39;font-size:28px;line-height:1;cursor:pointer}
.inquiry-dialog .detail-note{font-size:12px;line-height:1.7;color:#627572;margin:9px 0}.inquiry-dialog .inquiry-local-note{background:#eef2e9;border-radius:9px;padding:10px 13px;margin:16px 0 22px}
.inquiry-dialog .inquiry-items{display:grid;gap:14px}.inquiry-dialog .inquiry-item{display:block;border:1px solid #dce3d9;border-radius:13px;padding:17px;background:#fff}.inquiry-dialog .inquiry-item-unavailable{border-color:#ddb79d;background:#fffaf5}
.inquiry-dialog .inquiry-product-summary{display:flex;align-items:flex-start;gap:15px}.inquiry-dialog .inquiry-thumbnail{display:block;width:88px;height:88px;object-fit:contain;background:#f7f7f0;border-radius:8px;flex:0 0 88px}.inquiry-dialog .inquiry-no-image{display:grid;place-items:center;color:#7f8e84}.inquiry-dialog .inquiry-product-identity{flex:1;min-width:0;overflow-wrap:anywhere}.inquiry-dialog .inquiry-sku{font-size:12px;letter-spacing:.04em;color:var(--accent,#246154)}.inquiry-dialog .inquiry-product-identity h3{font-size:17px;line-height:1.4;margin:5px 0 2px}.inquiry-dialog .inquiry-second-name{font-size:12px;margin:0}.inquiry-dialog .inquiry-codes{font-size:11px;color:#627572;margin:7px 0 0;line-height:1.6}.inquiry-dialog .inquiry-remove{border:0;background:transparent;padding:6px 0 6px 8px;font-size:12px;color:#8d4838;text-decoration:underline;cursor:pointer;white-space:nowrap}
.inquiry-dialog .inquiry-inputs{display:grid;grid-template-columns:minmax(150px,.7fr) minmax(0,1.3fr);gap:12px;margin-top:15px}.inquiry-dialog .inquiry-inputs label{display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:600;color:#354f47}.inquiry-dialog .inquiry-inputs input,.inquiry-dialog .inquiry-inputs textarea{width:100%;min-width:0;box-sizing:border-box;border:1px solid #d4ddd3;border-radius:7px;background:#fff;padding:10px 12px;color:#183b39;font:400 14px/1.45 inherit;font-family:inherit;resize:vertical}.inquiry-dialog .inquiry-inputs input{min-height:42px}.inquiry-dialog .inquiry-inputs textarea{min-height:65px}
.inquiry-dialog .inquiry-export-area{margin-top:22px;border-top:1px solid #dae1d7;padding-top:22px}.inquiry-dialog .export-actions{display:flex;flex-wrap:wrap;gap:9px}.inquiry-dialog .export-actions button,.inquiry-dialog .inquiry-long-whatsapp a,.inquiry-dialog .empty-state .primary{min-height:44px;border:1px solid #cdd8cd;border-radius:8px;padding:11px 15px;font-family:inherit;font-size:13px;line-height:1.4;cursor:pointer;text-align:center;text-decoration:none}.inquiry-dialog .primary{background:var(--accent,#244f44);color:#fff;border-color:var(--accent,#244f44)!important}.inquiry-dialog .secondary{background:#fff;color:#234b40}.inquiry-dialog .whatsapp-button{background:#247c4e;color:#fff;border-color:#247c4e!important}.inquiry-dialog button:disabled{cursor:not-allowed;opacity:.45}.inquiry-dialog button:focus-visible,.inquiry-dialog a:focus-visible,.inquiry-dialog input:focus-visible,.inquiry-dialog textarea:focus-visible{outline:3px solid #c1a25d;outline-offset:3px}
.inquiry-dialog .export-status{font-size:13px;line-height:1.6;color:#315e47;margin:13px 0;overflow-wrap:anywhere}.inquiry-dialog .export-status:empty{display:none}.inquiry-dialog .inquiry-warning{font-size:13px;line-height:1.6;color:#8b4d22;background:#fff1df;border:1px solid #eed5b7;border-radius:8px;padding:10px 12px}.inquiry-dialog .inquiry-item-warning{font-size:12px;margin:8px 0 0}.inquiry-dialog .inquiry-long-whatsapp{border:1px solid #d6dfd4;border-radius:8px;padding:14px;margin:14px 0;font-size:13px;line-height:1.7;background:#f4f7ef}.inquiry-dialog .inquiry-long-whatsapp p{margin-top:0}.inquiry-dialog .inquiry-long-whatsapp a{display:inline-flex;align-items:center}.inquiry-dialog .inquiry-continue{border:0;background:transparent;color:#315e47;font-size:14px;padding:13px 0 3px;text-decoration:underline;cursor:pointer}.inquiry-dialog .empty-state{text-align:center;padding:45px 0}.inquiry-dialog .inquiry-progress{display:flex;flex-wrap:wrap;gap:10px;align-items:center;font-size:12px;margin-top:13px}.inquiry-dialog progress{max-width:100%;accent-color:var(--accent,#244f44)}
.inquiry-dialog .inquiry-preview{display:inline-flex;align-items:center;min-height:44px;color:#315e47;font-size:13px;text-decoration:underline;text-underline-offset:3px}
@media(max-width:600px){.inquiry-dialog{width:calc(100% - 14px);max-height:calc(100dvh - 14px);border-radius:14px}.inquiry-dialog .inquiry-inner{padding:19px 15px;max-height:calc(100dvh - 16px)}.inquiry-dialog .inquiry-item{padding:13px}.inquiry-dialog .inquiry-product-summary{gap:10px}.inquiry-dialog .inquiry-thumbnail{width:62px;height:70px;flex-basis:62px}.inquiry-dialog .inquiry-product-identity h3{font-size:15px}.inquiry-dialog .inquiry-inputs{grid-template-columns:1fr}.inquiry-dialog .inquiry-inputs input,.inquiry-dialog .inquiry-inputs textarea{font-size:16px}.inquiry-dialog .export-actions{display:grid;grid-template-columns:1fr 1fr}.inquiry-dialog .export-actions button{font-size:12px;padding:11px 9px}}
`;
