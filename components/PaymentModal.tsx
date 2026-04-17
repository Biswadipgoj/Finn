'use client';
import { useState, useEffect } from 'react';
import { Customer, EMISchedule, DueBreakdown } from '@/lib/types';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { calculateTotalFineFromEmis } from '@/lib/fineCalc';
import FineSummaryPanel from './FineSummaryPanel';
import { formatCurrency, readJsonSafe } from '@/lib/formatters';

interface Props { customer: Customer; emis: EMISchedule[]; breakdown: DueBreakdown | null; onClose: () => void; onSubmitted: () => void; isAdmin?: boolean; }
const UPI_ID = 'biswajit.khanra82@axl';
const fmt = formatCurrency;

export default function PaymentModal({ customer, emis, breakdown, onClose, onSubmitted, isAdmin }: Props) {
  const unpaidEmis = emis.filter(e => e.status === 'UNPAID' || e.status === 'PARTIALLY_PAID');
  const defaultEmiNo = breakdown?.next_emi_no ?? unpaidEmis[0]?.emi_no ?? null;
  const [selectedEmiNo, setSelectedEmiNo] = useState<number | null>(defaultEmiNo);
  const [mode, setMode] = useState<'CASH' | 'UPI'>('CASH');
  const [utr, setUtr] = useState('');
  const [retailerPin, setRetailerPin] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [showReceipt, setShowReceipt] = useState(false);
  const [receiptId, setReceiptId] = useState('');
  const [showFineSummary, setShowFineSummary] = useState(false);

  // CHECKBOX-BASED: auto-tick what's due, user can manually untick
  const selectedEmi = unpaidEmis.find(e => e.emi_no === selectedEmiNo) || emis.find(e => e.emi_no === selectedEmiNo);
  const scheduledEmiAmount = selectedEmi ? Math.max(0, Number(selectedEmi.amount || 0) - Number(selectedEmi.partial_paid_amount || 0)) : 0;
  const autoFine = calculateTotalFineFromEmis(emis);
  const scheduledFine = Math.max(breakdown?.fine_due ?? 0, autoFine);
  const scheduledCharge = breakdown?.first_emi_charge_due ?? (customer.first_emi_charge_paid_at ? 0 : (customer.first_emi_charge_amount || 0));

  const [collectEmi, setCollectEmi] = useState(true);
  const [collectFine, setCollectFine] = useState(scheduledFine > 0);
  const [collectCharge, setCollectCharge] = useState(scheduledCharge > 0);

  // Editable amounts (survive checkbox toggles)
  const [editEmi, setEditEmi] = useState('');
  const [editFine, setEditFine] = useState('');
  const [editCharge, setEditCharge] = useState('');

  // Computed amounts
  const emiAmt = collectEmi ? (editEmi !== '' ? Math.max(0, parseFloat(editEmi) || 0) : scheduledEmiAmount) : 0;
  const fineAmt = collectFine ? (editFine !== '' ? Math.max(0, parseFloat(editFine) || 0) : scheduledFine) : 0;
  const chargeAmt = collectCharge ? (editCharge !== '' ? Math.max(0, parseFloat(editCharge) || 0) : scheduledCharge) : 0;
  const total = emiAmt + fineAmt + chargeAmt;
  const missingRetailPin = !isAdmin && !retailerPin.trim();
  const missingUtr = mode === 'UPI' && !utr.trim();
  const cannotSubmit = loading || total <= 0 || missingRetailPin || missingUtr || (collectEmi && !selectedEmi);

  // Auto-tick what's due when fine/charge changes
  useEffect(() => { setCollectFine(scheduledFine > 0); setCollectCharge(scheduledCharge > 0); }, [scheduledFine, scheduledCharge]);
  useEffect(() => { if (selectedEmiNo == null && unpaidEmis.length > 0) setSelectedEmiNo(unpaidEmis[0].emi_no); }, [selectedEmiNo, unpaidEmis]);
  useEffect(() => { setEditEmi(''); setEditFine(''); setEditCharge(''); }, [selectedEmiNo]);

  // QR
  useEffect(() => {
    if (mode === 'UPI' && total > 0) {
      import('qrcode').then(QR => {
        QR.toDataURL(`upi://pay?pa=${UPI_ID}&pn=TelePoint&am=${total}&tn=EMI${selectedEmiNo ?? 'X'}_${customer.imei.slice(-6)}&cu=INR`, { width: 240, margin: 2, color: { dark: '#1e293b', light: '#ffffff' } }).then(setQrDataUrl);
      }).catch(() => {});
    } else setQrDataUrl('');
  }, [mode, total, selectedEmiNo, customer.imei]);

  // Derive collect_type for API
  function getCollectType() {
    if (collectEmi && collectFine && collectCharge) return 'emi_full_due';
    if (collectEmi && collectFine) return 'emi_fine';
    if (collectEmi && collectCharge) return 'emi_first_charge';
    if (collectEmi) return 'emi_only';
    if (collectFine) return 'fine_only';
    if (collectCharge) return 'first_charge_only';
    return 'emi_only';
  }

  async function handleSubmit() {
    if (collectEmi && !selectedEmi) { toast.error('Select an EMI'); return; }
    if (!isAdmin && !retailerPin.trim()) { toast.error('Enter Retail PIN'); return; }
    if (mode === 'UPI' && !utr.trim()) { toast.error('UTR required for UPI'); return; }
    if (total <= 0) { toast.error('Total must be > 0'); return; }
    setLoading(true);
    try {
      const res = await fetch(isAdmin ? '/api/payments/approve-direct' : '/api/payments/submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: customer.id,
          emi_ids: collectEmi && selectedEmi ? [selectedEmi.id] : [],
          emi_nos: collectEmi && selectedEmi ? [selectedEmi.emi_no] : [],
          mode, utr: mode === 'UPI' ? utr.trim() : null, notes: notes || null,
          retail_pin: isAdmin ? undefined : retailerPin,
          total_emi_amount: emiAmt, scheduled_emi_amount: scheduledEmiAmount,
          fine_amount: fineAmt, first_emi_charge_amount: chargeAmt,
          total_amount: total,
          fine_for_emi_no: fineAmt > 0 ? (selectedEmiNo ?? undefined) : undefined,
          fine_due_date: fineAmt > 0 && selectedEmi ? selectedEmi.due_date : undefined,
          collected_by_role: isAdmin ? 'admin' : 'retailer',
          collect_type: getCollectType(),
        }),
      });
      const data = await readJsonSafe<{ error?: string; request_id?: string }>(res) || { error: 'Server error' };
      if (!res.ok) toast.error(data.error || 'Failed');
      else {
        toast.success(isAdmin ? '✅ Payment approved!' : '📋 Request submitted');
        if (data.request_id) { setReceiptId(data.request_id); setShowReceipt(true); }
        else { onSubmitted(); onClose(); }
      }
    } catch (e: unknown) { toast.error('Failed: ' + (e instanceof Error ? e.message : '')); }
    finally { setLoading(false); }
  }

  if (showReceipt && receiptId) {
    const now = new Date();
    return (
      <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) { onSubmitted(); onClose(); } }}>
        <div className="modal-panel max-w-sm mx-auto animate-scale-in">
          <div className="bg-brand-500 px-6 py-5 text-center"><div className="text-4xl mb-2">{isAdmin ? '✅' : '📋'}</div><h2 className="text-white font-bold text-xl">{isAdmin ? 'Payment Approved' : 'Request Submitted'}</h2></div>
          <div className="p-5 space-y-3">
            <div className="card bg-surface-2 p-4 space-y-2">
              <div className="flex justify-between text-sm"><span className="text-ink-muted">Customer</span><span className="font-semibold text-ink">{customer.customer_name}</span></div>
              <div className="flex justify-between text-sm"><span className="text-ink-muted">IMEI</span><span className="num text-ink">{customer.imei}</span></div>
              {emiAmt > 0 && <div className="flex justify-between text-sm"><span className="text-ink-muted">EMI {selectedEmiNo ? `#${selectedEmiNo}` : ''}</span><span className="num font-semibold">{fmt(emiAmt)}</span></div>}
              {chargeAmt > 0 && <div className="flex justify-between text-sm"><span className="text-warning">1st Charge</span><span className="num text-warning">{fmt(chargeAmt)}</span></div>}
              {fineAmt > 0 && <div className="flex justify-between text-sm"><span className="text-danger">Fine</span><span className="num text-danger">{fmt(fineAmt)}</span></div>}
              <div className="h-px bg-surface-4" />
              <div className="flex justify-between"><span className="font-bold">Total</span><span className="num text-xl font-bold text-brand-600">{fmt(total)}</span></div>
            </div>
            <button onClick={() => { const m = [`🧾 *TelePoint EMI Receipt*`,'',`👤 ${customer.customer_name}`,`📱 ${customer.mobile}`,`🔢 IMEI: ${customer.imei}`,'',emiAmt>0?`💳 EMI ${selectedEmiNo ? `#${selectedEmiNo}` : ''}: ${fmt(emiAmt)}`:'',chargeAmt>0?`⭐ Charge: ${fmt(chargeAmt)}`:'',fineAmt>0?`⚠️ Fine: ${fmt(fineAmt)}`:'',`💰 *Total: ${fmt(total)}*`,`🏷️ ${mode}`,`📅 ${format(now,'d MMM yyyy, h:mm a')}`,'','— TelePoint'].filter(Boolean).join('\n'); window.open(`https://wa.me/?text=${encodeURIComponent(m)}`,'_blank'); }} className="btn w-full py-3 bg-green-500 hover:bg-green-600 text-white">📤 Share WhatsApp</button>
            <button onClick={() => { onSubmitted(); onClose(); }} className="btn-ghost w-full py-2.5">Close</button>
          </div>
        </div>
      </div>
    );
  }

  if (showFineSummary) return <FineSummaryPanel emis={emis} onClose={() => setShowFineSummary(false)} />;

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-panel flex flex-col">
        <div className="sticky top-0 z-10 bg-white border-b border-surface-4 px-4 py-3 flex items-center justify-between">
          <div><h2 className="font-bold text-ink text-base sm:text-lg">{isAdmin ? 'Record Payment' : 'Submit Payment'}</h2><p className="text-ink-muted text-xs mt-0.5">{customer.customer_name} · {customer.imei}</p></div>
          <button onClick={onClose} className="btn-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
        </div>
        <div className="p-4 space-y-4 overflow-y-auto pb-24 sm:pb-4">
          {/* WHAT TO COLLECT — checkboxes */}
          <div className="card bg-surface-2 p-4 space-y-3">
            <p className="text-xs font-bold text-ink-muted uppercase tracking-widest">Select What to Collect</p>
            <label className={`flex items-center justify-between p-3 rounded-xl border-2 cursor-pointer transition-all ${collectEmi ? 'border-brand-400 bg-brand-50' : 'border-surface-4'}`}>
              <div className="flex items-center gap-3">
                <input type="checkbox" checked={collectEmi} onChange={e => setCollectEmi(e.target.checked)} className="w-5 h-5 accent-brand-500 rounded" />
                <div><p className="text-sm font-semibold text-ink">💳 EMI {selectedEmiNo ? `#${selectedEmiNo}` : 'selection'}</p><p className="text-xs text-ink-muted">Due: {fmt(scheduledEmiAmount)}{selectedEmi && Number(selectedEmi.partial_paid_amount || 0) > 0 ? ` · Paid ${fmt(selectedEmi.partial_paid_amount || 0)}` : ''}</p></div>
              </div>
              <span className="num font-semibold text-ink">{fmt(scheduledEmiAmount)}</span>
            </label>
            {scheduledFine > 0 && (
              <label className={`flex items-center justify-between p-3 rounded-xl border-2 cursor-pointer transition-all ${collectFine ? 'border-danger bg-danger-light' : 'border-surface-4'}`}>
                <div className="flex items-center gap-3">
                  <input type="checkbox" checked={collectFine} onChange={e => setCollectFine(e.target.checked)} className="w-5 h-5 accent-red-500 rounded" />
                  <div><p className="text-sm font-semibold text-danger">⚠️ Late Fine</p><p className="text-xs text-ink-muted">₹450 base + ₹25/week</p></div>
                </div>
                <span className="num font-semibold text-danger">{fmt(scheduledFine)}</span>
              </label>
            )}
            {scheduledCharge > 0 && (
              <label className={`flex items-center justify-between p-3 rounded-xl border-2 cursor-pointer transition-all ${collectCharge ? 'border-warning bg-warning-light' : 'border-surface-4'}`}>
                <div className="flex items-center gap-3">
                  <input type="checkbox" checked={collectCharge} onChange={e => setCollectCharge(e.target.checked)} className="w-5 h-5 accent-amber-500 rounded" />
                  <div><p className="text-sm font-semibold text-warning">⭐ 1st EMI Charge</p><p className="text-xs text-ink-muted">One-time charge</p></div>
                </div>
                <span className="num font-semibold text-warning">{fmt(scheduledCharge)}</span>
              </label>
            )}
          </div>

          {/* Fine Summary button */}
          {scheduledFine > 0 && (
            <button type="button" onClick={() => setShowFineSummary(true)} className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl border border-danger-border bg-danger-light text-left hover:border-danger transition-all">
              <span className="text-sm font-semibold text-danger">⚠️ Fine Details</span>
              <span className="text-xs text-danger">View →</span>
            </button>
          )}

          {/* EMI Selector */}
          {collectEmi && (<div><label className="label">Select EMI *</label>
            {unpaidEmis.length === 0 ? <p className="text-success font-semibold text-sm py-3 text-center">✓ All EMIs paid</p> : (
              <div className="space-y-2 max-h-48 overflow-y-auto">{unpaidEmis.map(emi => {
                const sel = selectedEmiNo === emi.emi_no; const isOverdue = new Date(emi.due_date) < new Date();
                return (<button key={emi.id} type="button" onClick={() => setSelectedEmiNo(emi.emi_no)} className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border-2 text-left transition-all ${sel ? 'border-brand-400 bg-brand-50' : 'border-surface-4'}`}>
                  <div className="flex items-center gap-2">
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${sel ? 'bg-brand-500 border-brand-500' : 'border-surface-4'}`}>{sel && <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4"><path d="M20 6L9 17l-5-5"/></svg>}</div>
                    <span className={`text-sm font-semibold ${sel ? 'text-brand-700' : 'text-ink'}`}>EMI #{emi.emi_no}</span>
                  </div>
                  <div className="text-right"><span className="num text-sm font-semibold">{fmt(emi.amount)}</span><br/><span className={`text-[10px] ${isOverdue ? 'text-danger' : 'text-ink-muted'}`}>{format(new Date(emi.due_date), 'd MMM')}{isOverdue && ' ⚠'}</span></div>
                </button>);
              })}</div>
            )}
          </div>)}

          {/* Mode */}
          <div className="flex gap-2">{(['CASH','UPI'] as const).map(m => (<button key={m} type="button" onClick={() => setMode(m)} className={`flex-1 py-3 rounded-xl border-2 text-sm font-semibold transition-all ${mode === m ? (m === 'CASH' ? 'border-success bg-success-light text-success' : 'border-info bg-info-light text-info') : 'border-surface-4 text-ink-muted'}`}>{m === 'CASH' ? '💵 Cash' : '📱 UPI'}</button>))}</div>
          {mode === 'UPI' && <input type="text" value={utr} onChange={e => setUtr(e.target.value)} placeholder="UTR / Reference *" className={`input ${!utr.trim() ? 'border-warning' : ''}`} />}
          {missingUtr && <p className="text-[11px] text-warning">UPI mode requires UTR / Reference to enable Record Payment.</p>}
          {mode === 'UPI' && qrDataUrl && <div className="flex flex-col items-center"><img src={qrDataUrl} alt="QR" className="w-44 h-44 rounded-xl border border-surface-4" /><p className="num text-xs text-ink-muted mt-1">{UPI_ID}</p></div>}

          {!isAdmin && <input type="password" value={retailerPin} onChange={e => setRetailerPin(e.target.value)} placeholder="Retail PIN *" inputMode="numeric" className="input" />}
          {missingRetailPin && <p className="text-[11px] text-warning">Retail PIN is required to submit payment.</p>}
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Notes (optional)" className="input resize-none" />

          {/* Editable amounts */}
          <div className="card bg-surface-2 p-3 space-y-2">
            <p className="text-xs font-bold text-ink-muted uppercase tracking-widest">Amounts <span className="font-normal text-brand-500">(editable)</span></p>
            {collectEmi && <div className="flex items-center gap-2"><label className="text-xs text-ink-muted w-20">EMI</label><input type="number" min={0} value={editEmi} onChange={e => setEditEmi(e.target.value)} placeholder={String(scheduledEmiAmount)} className="input flex-1 py-2" inputMode="numeric" /></div>}
            {collectFine && scheduledFine > 0 && <div className="flex items-center gap-2"><label className="text-xs text-danger w-20">Fine</label><input type="number" min={0} value={editFine} onChange={e => setEditFine(e.target.value)} placeholder={String(scheduledFine)} className="input flex-1 py-2" inputMode="numeric" /></div>}
            {collectCharge && scheduledCharge > 0 && <div className="flex items-center gap-2"><label className="text-xs text-warning w-20">Charge</label><input type="number" min={0} value={editCharge} onChange={e => setEditCharge(e.target.value)} placeholder={String(scheduledCharge)} className="input flex-1 py-2" inputMode="numeric" /></div>}
          </div>

          {/* Total */}
          <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-brand-50 border border-brand-200">
            <span className="font-bold text-ink">Total</span>
            <span className="num text-2xl font-bold text-brand-600">{fmt(total)}</span>
          </div>

        </div>
        <div className="sticky bottom-0 z-20 bg-white border-t border-surface-4 p-3 flex gap-3">
          <button onClick={onClose} className="btn-secondary flex-1 py-3">Cancel</button>
          <button onClick={handleSubmit} disabled={loading} className="btn-primary flex-1 py-3">{loading ? '...' : isAdmin ? '✓ Record' : '→ Submit'}</button>
        </div>
      </div>
    </div>
  );
}
