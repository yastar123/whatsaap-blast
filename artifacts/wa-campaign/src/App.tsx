import { useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, Route, Switch, useLocation } from 'wouter';
import {
  Activity, ArrowDownLeft, ArrowUpRight, BadgeCheck, BarChart3, Bell, Blocks,
  Check, ChevronDown, CircleHelp, ClipboardList, Clock3, CreditCard,
  FileText, Gauge, LayoutDashboard, Link2, LogOut, Menu,
  MessageCircle, Plus, Search, Send, Settings2, ShieldCheck,
  Smartphone, Sparkles, Users, Wallet as WalletIcon, X, QrCode, RotateCw, Download,
  Ban, UserRound, Copy, Upload, CheckCircle2, CircleAlert, TrendingUp
} from 'lucide-react';
import {
  getGetCurrentUserQueryKey, getGetDashboardOverviewQueryKey, getGetSettingsQueryKey,
  getGetWalletQueryKey, getGetActiveCampaignQueryKey,
  getGetCurrentBlastQueryKey, getListCampaignsQueryKey, getListContactsQueryKey,
  getListResultsQueryKey, getGetResultsSummaryQueryKey, getListCampaignResultSummariesQueryKey,
  getListWaSessionsQueryKey, getListUsersQueryKey, getListWithdrawalsQueryKey,
  getListAdminWaSessionsQueryKey,
  useGetCurrentUser, useGetDashboardOverview, useGetSettings, useGetWallet, useGetReferrals,
  useGetActiveCampaign, useGetCurrentBlast, useListCampaigns, useListContacts, useListResults,
  useGetResultsSummary, useListCampaignResultSummaries, useListWaSessions, useListUsers,
  useListWithdrawals, useListAdminWaSessions, useDisconnectAdminWaSession,
  useLogin, useRegister, useLogout, useCreateWaSession, useConnectWaSession,
  useDeleteWaSession, useCreateCampaign, useUpdateCampaign, useDeleteCampaign, useActivateCampaign,
  useImportContacts, useDeleteContact, useStartBlast, useCancelBlast, useRequestWithdrawal,
  useUpdateWithdrawal, useUpdateUserStatus, useUpdateSettings, setAuthTokenGetter
} from '@workspace/api-client-react';
import type { AppSettings, Campaign, Contact } from '@workspace/api-client-react';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ErrorBoundary } from '@/components/error-boundary';
import { clearAuthTokens, getAccessToken, saveAuthTokens } from './lib/auth-storage';
import { io } from 'socket.io-client';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
setAuthTokenGetter(getAccessToken);
const money = (amount?: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amount || 0);
const date = (value?: string | null) => value ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
const navGroups = [
  { title: 'Ruang kerja', links: [{ href: '/', label: 'Ringkasan', icon: LayoutDashboard }, { href: '/whatsapp', label: 'WhatsApp', icon: Smartphone }, { href: '/blast', label: 'Kirim kampanye', icon: Send }, { href: '/results', label: 'Hasil pengiriman', icon: BarChart3 }] },
  { title: 'Keuangan', links: [{ href: '/wallet', label: 'Dompet', icon: WalletIcon }, { href: '/referrals', label: 'Referral', icon: Users }, { href: '/withdrawals', label: 'Penarikan', icon: CreditCard }] },
  { title: 'Administrasi', links: [{ href: '/campaigns', label: 'Kampanye', icon: Blocks, admin: true }, { href: '/contacts', label: 'Kontak & consent', icon: ClipboardList, admin: true }, { href: '/customers', label: 'Akun pengirim', icon: UserRound, admin: true }, { href: '/admin/sessions', label: 'Sesi semua pengirim', icon: Smartphone, admin: true }, { href: '/settings', label: 'Pengaturan', icon: Settings2, admin: true }] },
];
const titles: Record<string, [string, string]> = {
  '/': ['Ringkasan operasi', 'Pantau kampanye, sesi, dan arus pengiriman.'],
  '/whatsapp': ['Sesi WhatsApp', 'Kelola pairing perangkat yang terhubung.'],
  '/blast': ['Kirim kampanye', 'Mulai pengiriman untuk kontak dengan consent tercatat.'],
  '/results': ['Hasil pengiriman', 'Telusuri status pengiriman dari server.'],
  '/wallet': ['Dompet', 'Saldo, pendapatan, dan riwayat transaksi Anda.'],
  '/referrals': ['Referral', 'Lihat jaringan dan pendapatan referral.'],
  '/withdrawals': ['Penarikan', 'Ajukan pencairan dan pantau status permintaan.'],
  '/campaigns': ['Kampanye', 'Kelola naskah dan pilih kampanye aktif.'],
  '/contacts': ['Kontak & consent', 'Impor hanya kontak dengan bukti persetujuan.'],
  '/customers': ['Akun pengirim', 'Kelola akses akun customer.'],
  '/admin/sessions': ['Sesi semua pengirim', 'Pantau dan putuskan sesi WhatsApp milik customer.'],
  '/settings': ['Pengaturan bisnis', 'Atur tarif dan batas operasional.'],
};

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><Switch>
    <Route path="/login"><AuthPage mode="login" /></Route>
    <Route path="/register"><AuthPage mode="register" /></Route>
    <Route><Shell /></Route>
  </Switch><Toaster /></TooltipProvider></QueryClientProvider>;
}

function Shell() {
  const [path] = useLocation();
  const [mobileNav, setMobileNav] = useState(false);
  const { data: user, isLoading, isError, refetch } = useGetCurrentUser();
  const logout = useLogout();
  if (isLoading) return <div className="loading-screen"><div className="skeleton brand-skeleton" /><div className="skeleton line-skeleton" /><div className="skeleton content-skeleton" /></div>;
  if (isError || !user) return <AuthPage mode="login" />;
  const currentTitle = titles[path] || ['Halaman tidak ditemukan', ''];
  const adminOnlyPaths = ['/campaigns', '/contacts', '/customers', '/admin/sessions', '/settings'];
  const customerOnlyPaths = ['/whatsapp', '/blast', '/wallet', '/referrals'];
  const shownGroups = navGroups.map(group => ({
    ...group,
    links: group.links.filter(link => user.role === 'admin'
      ? !customerOnlyPaths.includes(link.href)
      : !adminOnlyPaths.includes(link.href)),
  })).filter(group => group.links.length);
  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
      <Link href="/" className="brand-lockup"><span className="brand-mark"><MessageCircle size={19} /></span><span><b>titip<span>kirim</span></b><small>OPERATIONS DESK</small></span></Link>
      <div className="workspace-label">WORKSPACE <span className="workspace-dot" /></div>
      <nav className="side-nav">{shownGroups.map(group => <section className="nav-group" key={group.title}><div className="nav-heading">{group.title}</div>{group.links.map(item => {
        const Icon = item.icon; return <Link data-testid={`link-nav-${item.href.slice(1) || 'overview'}`} key={item.href} href={item.href} className={`nav-link ${path === item.href ? 'nav-active' : ''}`} onClick={() => setMobileNav(false)}><Icon size={17} /><span>{item.label}</span>{item.href === '/whatsapp' && <i className="nav-live" />}</Link>;
      })}</section>)}</nav>
      <div className="sidebar-bottom"><div className="consent-card"><div className="consent-icon"><ShieldCheck size={18} /></div><div><b>Consent terjaga</b><p>Setiap pengiriman memeriksa persetujuan kontak.</p></div></div><button className="help-link" onClick={() => window.location.href = 'mailto:bantuan@titipkirim.id'}><CircleHelp size={16} /> Pusat bantuan <ArrowUpRight size={13} /></button></div>
       <div className="profile-row"><div className="avatar">{user.name.slice(0, 1).toUpperCase()}</div><div className="profile-copy"><b>{user.name}</b><span>{user.role === 'admin' ? 'Administrator' : 'Customer'}</span></div><button aria-label="Keluar" className="icon-button sidebar-logout" onClick={() => logout.mutate(undefined, { onSuccess: () => { clearAuthTokens(); queryClient.removeQueries({ queryKey: getGetCurrentUserQueryKey() }); window.location.assign('/login'); } })}><LogOut size={16} /></button></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><button className="icon-button mobile-menu" aria-label="Buka navigasi" onClick={() => setMobileNav(!mobileNav)}><Menu size={19} /></button><div className="breadcrumbs"><span>titipkirim</span><span className="crumb-slash">/</span><b>{currentTitle[0]}</b></div><div className="topbar-actions"><div className="system-status"><span /> Sistem beroperasi</div><button className="icon-button notification-button" aria-label="Notifikasi"><Bell size={17} /><i /></button><div className="top-profile"><span className="avatar avatar-small">{user.name.slice(0, 1).toUpperCase()}</span><span>{user.name}</span><ChevronDown size={14} /></div></div></header>
      <div className="page-wrap"><div className="page-heading"><div><div className="eyebrow">{user.role === 'admin' ? 'PANEL ADMINISTRATOR' : 'PORTAL PENGIRIM'}</div><h1>{currentTitle[0]}</h1><p>{currentTitle[1]}</p></div><div className="page-date"><span className="date-dot" /> {new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())}</div></div>
        <ErrorBoundary resetKey={path}><Switch>
          <Route path="/"><DashboardPage user={user} /></Route>
          <Route path="/whatsapp">{user.role === 'customer' ? <WhatsAppPage /> : <Forbidden />}</Route>
          <Route path="/blast">{user.role === 'customer' ? <BlastPage role={user.role} /> : <Forbidden />}</Route>
          <Route path="/results"><ResultsPage role={user.role} userId={user.id} /></Route>
          <Route path="/wallet">{user.role === 'customer' ? <WalletPage /> : <Forbidden />}</Route>
          <Route path="/referrals">{user.role === 'customer' ? <ReferralsPage /> : <Forbidden />}</Route>
          <Route path="/withdrawals"><WithdrawalsPage role={user.role} /></Route>
          <Route path="/campaigns">{user.role === 'admin' ? <CampaignsPage /> : <Forbidden />}</Route>
          <Route path="/contacts">{user.role === 'admin' ? <ContactsPage /> : <Forbidden />}</Route>
          <Route path="/customers">{user.role === 'admin' ? <CustomersPage /> : <Forbidden />}</Route>
          <Route path="/admin/sessions">{user.role === 'admin' ? <AdminWaSessionsPage /> : <Forbidden />}</Route>
          <Route path="/settings">{user.role === 'admin' ? <SettingsPage /> : <Forbidden />}</Route>
          <Route><NotFound /></Route>
        </Switch></ErrorBoundary>
      </div>
      <footer className="page-footer"><span>titipkirim <b>·</b> Operasional yang dapat dipercaya</span><span><ShieldCheck size={13} /> Pengiriman consent-first</span></footer>
    </main>
  </div>;
}

function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const registerMode = mode === 'register';
  const [, setLocation] = useLocation();
  const login = useLogin();
  const register = useRegister();
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    referralCode: new URLSearchParams(window.location.search).get('ref') || '',
  });
  const [error, setError] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const mutation = registerMode ? register : login;
    const data = registerMode
      ? {
          name: form.name,
          email: form.email,
          password: form.password,
          ...(form.referralCode ? { referralCode: form.referralCode } : {}),
        }
      : { email: form.email, password: form.password };

    mutation.mutate(
      { data } as never,
      {
        onSuccess: result => {
          saveAuthTokens(result);
          queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
          setLocation('/');
        },
        onError: err =>
          setError(
            err instanceof Error
              ? err.message
              : 'Tidak dapat masuk. Periksa kembali data Anda.',
          ),
      },
    );
  };

  return (
    <div className="auth-layout">
      <section className="auth-aside">
        <Link className="brand-lockup auth-brand" href="/login">
          <span className="brand-mark"><MessageCircle size={19} /></span>
          <span>
            <b>titip<span>kirim</span></b>
            <small>OPERATIONS DESK</small>
          </span>
        </Link>
        <div className="auth-illustration">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="auth-note note-a">
            <ShieldCheck size={17} />
            <span>Persetujuan terverifikasi</span>
            <Check size={14} />
          </div>
          <div className="auth-note note-b">
            <Activity size={17} />
            <span>Pengiriman tercatat</span>
          </div>
          <div className="auth-center">
            <MessageCircle size={43} />
            <div className="auth-center-ring" />
          </div>
        </div>
        <div className="auth-aside-copy">
          <span>01 / OPERASI BERTANGGUNG JAWAB</span>
          <h2>Pengiriman yang<br />terukur. <em>Terpercaya.</em></h2>
          <p>Meja operasi untuk kampanye WhatsApp dengan persetujuan yang selalu tercatat.</p>
        </div>
        <div className="aside-foot">
          BAILEYS-LINKED SESSIONS <span>•</span> CONSENT-FIRST DELIVERY
        </div>
      </section>
      <section className="auth-main">
        <div className="mobile-brand">titip<span>kirim</span></div>
        <div className="auth-eyebrow">SELAMAT DATANG KEMBALI</div>
        <h1>{registerMode ? 'Buat akun Anda' : 'Masuk ke workspace'}</h1>
        <p className="auth-subtitle">
          {registerMode
            ? 'Mulai kelola pengiriman Anda dengan aman.'
            : 'Gunakan akun yang terdaftar untuk melanjutkan.'}
        </p>
        <form onSubmit={submit} className="auth-form">
          {registerMode && (
            <label>
              Nama lengkap
              <input
                required
                minLength={2}
                autoComplete="name"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="Nama Anda"
                data-testid="input-name"
              />
            </label>
          )}
          <label>
            Email
            <input
              required
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={e => setForm({ ...form, email: e.target.value })}
              placeholder="nama@email.com"
              data-testid="input-email"
            />
          </label>
          <label>
            Kata sandi
            <input
              required
              minLength={registerMode ? 10 : 1}
              type="password"
              autoComplete={registerMode ? 'new-password' : 'current-password'}
              value={form.password}
              onChange={e => setForm({ ...form, password: e.target.value })}
              placeholder={registerMode ? 'Minimal 10 karakter' : 'Masukkan kata sandi'}
              data-testid="input-password"
            />
          </label>
          {registerMode && (
            <label>
              Kode referral <span className="optional">OPSIONAL</span>
              <input
                value={form.referralCode}
                onChange={e => setForm({ ...form, referralCode: e.target.value })}
                placeholder="Kode undangan"
              />
            </label>
          )}
          {error && (
            <div className="inline-error">
              <CircleAlert size={16} />
              {error}
            </div>
          )}
          <button
            className="button button-primary auth-submit"
            disabled={login.isPending || register.isPending}
          >
            {login.isPending || register.isPending
              ? 'Memeriksa...'
              : registerMode
                ? 'Buat akun'
                : 'Masuk ke dashboard'}
            <ArrowUpRight size={16} />
          </button>
        </form>
        <div className="auth-switch">
          {registerMode ? 'Sudah memiliki akun?' : 'Belum memiliki akun?'}
          <Link href={registerMode ? '/login' : '/register'}>
            {registerMode ? 'Masuk' : 'Daftar sebagai customer'}
          </Link>
        </div>
        <div className="auth-trust">
          <ShieldCheck size={15} />
          Data persetujuan disimpan sebagai bagian dari alur operasional.
        </div>
        <div className="auth-bottom">
          © {new Date().getFullYear()} titipkirim <span>Privasi</span><span>Bantuan</span>
        </div>
      </section>
    </div>
  );
}

function SectionTitle({ title, detail, action }: { title: string; detail?: string; action?: React.ReactNode }) { return <div className="section-title"><div><h2>{title}</h2>{detail && <p>{detail}</p>}</div>{action}</div>; }
function LoadingBlock() { return <div className="panel loading-panel"><div className="skeleton line-skeleton" /><div className="skeleton content-skeleton" /></div>; }
function ErrorBlock({ retry }: { retry: () => void }) { return <div className="empty-panel"><CircleAlert /><b>Data belum dapat dimuat</b><span>Periksa koneksi Anda, lalu coba kembali.</span><button className="button button-secondary" onClick={retry}><RotateCw size={15} /> Coba lagi</button></div>; }
function Empty({ title, text }: { title: string; text: string }) { return <div className="empty-panel"><div className="empty-icon"><FileText size={21} /></div><b>{title}</b><span>{text}</span></div>; }
function Metric({ label, value, hint, icon: Icon, tone = '' }: { label: string; value: string | number; hint?: string; icon: typeof Activity; tone?: string }) { return <div className="metric-card"><div className={`metric-icon ${tone}`}><Icon size={18} /></div><div className="metric-label">{label}</div><div className="metric-value" data-testid={`metric-${label.toLowerCase().replaceAll(' ', '-')}`}>{value}</div>{hint && <div className="metric-hint">{hint}</div>}</div>; }
function Status({ value }: { value?: string | null }) { const key = value || '—'; const labels: Record<string, string> = { online: 'Terhubung', offline: 'Terputus', inactive: 'Tidak aktif', connecting: 'Menghubungkan', logged_out: 'Keluar', active: 'Aktif', draft: 'Draf', paused: 'Dijeda', completed: 'Selesai', cancelled: 'Dibatalkan', running: 'Berjalan', sent: 'Terkirim', failed: 'Gagal', pending: 'Menunggu', unsent: 'Belum dikirim', opted_out: 'Berhenti', approved: 'Diproses', rejected: 'Ditolak', paid: 'Berhasil', withdraw_refund: 'Pengembalian dana', blocked: 'Diblokir' }; return <span className={`status status-${key}`}>{labels[key] || key}</span>; }
function DashboardPage({ user }: { user: { role: string; id: string } }) {
  const overview = useGetDashboardOverview(); const sessions = useListWaSessions();
  if (overview.isLoading) return <LoadingBlock />; if (overview.isError) return <ErrorBlock retry={() => overview.refetch()} />;
  const d = overview.data; const admin = user.role === 'admin';
  return <><div className="welcome-strip"><div><span className="welcome-kicker">MEJA OPERASI <i /></span><h2>{admin ? 'Semua jalur terkendali.' : 'Siap mengirim dengan aman?'}</h2><p>{admin ? 'Pantau alur kampanye dan aktivitas pengirim dari satu tempat.' : 'Pengiriman hanya berjalan untuk kontak yang memiliki consent aktif.'}</p></div><div className="welcome-symbol"><Gauge size={30} /><span>LIVE</span></div></div>
    <div className="metrics-grid">{admin ? <><Metric label="Customer aktif" value={d?.totalCustomers ?? '—'} hint="Akun pengirim terdaftar" icon={Users} /><Metric label="Sesi online" value={d?.onlineSessions ?? '—'} hint="Koneksi Baileys aktif" icon={Smartphone} tone="mint" /><Metric label="Terkirim" value={(d?.sentTotal ?? 0).toLocaleString('id-ID')} hint="Total seluruh pengiriman" icon={Send} tone="gold" /><Metric label="Nilai dibayar" value={money(d?.paidTotal)} hint="Saldo yang telah dilepas" icon={WalletIcon} tone="blue" /></> : <><Metric label="Pesan terkirim" value={(d?.sentByMe ?? 0).toLocaleString('id-ID')} hint="Tercatat atas akun Anda" icon={Send} tone="mint" /><Metric label="Pesan gagal" value={(d?.failedByMe ?? 0).toLocaleString('id-ID')} hint="Periksa hasil pengiriman" icon={CircleAlert} tone="rose" /><Metric label="Saldo tersedia" value={money(d?.mainBalance)} hint="Siap diajukan untuk penarikan" icon={WalletIcon} tone="gold" /><Metric label="Saldo berjalan" value={money(d?.runningBalance)} hint="Dari blast yang sedang berjalan" icon={Clock3} tone="blue" /></>}</div>
    <div className="dashboard-grid"><section className="panel campaign-panel"><SectionTitle title={admin ? 'Kampanye aktif' : 'Kampanye pilihan admin'} detail="Kontak dengan persetujuan aktif saja." action={<Link href={admin ? '/campaigns' : '/blast'} className="text-link">{admin ? 'Kelola kampanye' : 'Buka pengiriman'} <ArrowUpRight size={14} /></Link>} />{d?.activeCampaign ? <div className="active-campaign"><div className="campaign-art"><div className="art-orbit" /><MessageCircle size={28} /><span>CAMPAIGN / {d.activeCampaign.id.slice(0, 5)}</span></div><div className="campaign-copy"><div className="campaign-title-row"><h3>{d.activeCampaign.title}</h3><Status value={d.activeCampaign.status} /></div><p>{d.activeCampaign.messageText}</p><div className="campaign-stats"><span><b>{d.activeCampaign.contactTotal.toLocaleString('id-ID')}</b> kontak consent</span><span><b>{d.activeCampaign.sentCount.toLocaleString('id-ID')}</b> terkirim</span></div></div></div> : <Empty title="Belum ada kampanye aktif" text="Kampanye yang dipilih administrator akan tampil di sini." />}</section>
      <section className="panel session-panel"><SectionTitle title="Sesi WhatsApp" detail="Status koneksi akun" action={<Link className="icon-link" href="/whatsapp"><ArrowUpRight size={15} /></Link>} />{sessions.data?.length ? <div className="session-list">{sessions.data.slice(0, 3).map(s => <div className="session-row" key={s.id}><div className="session-icon"><Smartphone size={17} /></div><div className="session-copy"><b>{s.label}</b><span>{s.phone || 'Nomor belum terhubung'}</span></div><Status value={s.status} /></div>)}</div> : <div className="compact-empty"><Smartphone size={19} /><span>Belum ada sesi WhatsApp</span><Link href="/whatsapp">Hubungkan sesi <ArrowUpRight size={13} /></Link></div>}<Link href="/whatsapp" className="session-action">Kelola sesi <ArrowUpRight size={14} /></Link></section>
    </div>
    <div className="lower-grid"><section className="panel activity-panel"><SectionTitle title="Aktivitas terkini" detail="Catatan terbaru di workspace" /><div className="activity-list">{d?.recentActivity?.length ? d.recentActivity.slice(0, 5).map((a, i) => <div className="activity-row" key={a.id}><span className={`activity-mark activity-${i % 3}`}><Activity size={14} /></span><div><b>{a.title}</b><p>{a.detail}</p></div><time>{date(a.createdAt)}</time></div>) : <Empty title="Belum ada aktivitas" text="Aktivitas terbaru akan tercatat di sini." />}</div></section>
      <section className="panel principles-panel"><div className="principle-overline"><ShieldCheck size={15} /> KEBIJAKAN PENGIRIMAN</div><h3>Persetujuan dulu.<br /><em>Pengiriman sesudahnya.</em></h3><p>Nomor tanpa sumber consent yang tercatat tidak masuk ke daftar kirim. Tidak ada rotasi akun otomatis.</p><div className="principle-rule"><BadgeCheck size={15} /> Pemeriksaan consent sebelum proses</div><div className="principle-rule"><Activity size={15} /> Setiap hasil tercatat per sesi</div></section></div>
  </>;
}

function WhatsAppPage() {
  const qc = useQueryClient(); const sessions = useListWaSessions(); const create = useCreateWaSession(); const connect = useConnectWaSession(); const remove = useDeleteWaSession();
  const [label, setLabel] = useState(''); const [selected, setSelected] = useState(''); const [mode, setMode] = useState<'qr' | 'pairing_code'>('qr'); const [phone, setPhone] = useState(''); const [authData, setAuthData] = useState<{qrDataUrl?: string | null; pairingCode?: string | null} | null>(null); const [error, setError] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: getListWaSessionsQueryKey() });
  useEffect(() => {
    let socket: ReturnType<typeof io> | null = null;
    let disposed = false;
    void getAccessToken().then(token => {
      if (!token || disposed) return;
      socket = io({ path: '/api/socket.io', auth: { token }, transports: ['websocket', 'polling'] });
      socket.on('wa:qr', (event: { qrDataUrl: string }) => setAuthData({ qrDataUrl: event.qrDataUrl }));
      socket.on('wa:pairing-code', (event: { pairingCode: string }) => setAuthData({ pairingCode: event.pairingCode }));
      socket.on('wa:status', () => refresh());
      socket.on('connect_error', () => setError('Koneksi realtime terputus. Muat ulang pairing jika kode tidak muncul.'));
    });
    return () => { disposed = true; socket?.disconnect(); };
  }, []);
  if (sessions.isLoading) return <LoadingBlock />; if (sessions.isError) return <ErrorBlock retry={() => sessions.refetch()} />;
  const connectSession = (id: string) => { setError(''); setSelected(id); connect.mutate({ sessionId: id, data: { method: mode, ...(mode === 'pairing_code' ? { phone } : {}) } }, { onSuccess: result => { setAuthData(result); refresh(); }, onError: e => setError(e instanceof Error ? e.message : 'Pairing tidak berhasil.') }); };
  return <div className="whatsapp-layout"><section className="panel session-manager"><SectionTitle title="Perangkat terdaftar" detail={`${sessions.data?.length || 0} sesi dalam workspace`} action={<span className="secure-badge"><ShieldCheck size={13} /> Koneksi privat</span>} />
    {sessions.data?.length ? <div className="session-table">{sessions.data.map(s => <div className="session-manage-row" key={s.id}><div className="session-icon"><Smartphone size={18} /></div><div className="session-copy"><b>{s.label}</b><span>{s.phone || 'Nomor belum terhubung'}{s.lastConnectedAt ? ` · Terakhir ${date(s.lastConnectedAt)}` : ''}</span></div><Status value={s.status} /><button className="button button-secondary button-small" disabled={connect.isPending} onClick={() => connectSession(s.id)}><QrCode size={14} /> Pairing</button><button aria-label={`Hapus ${s.label}`} className="icon-button danger-icon" onClick={() => { if (window.confirm(`Hapus sesi ${s.label}?`)) remove.mutate({ sessionId: s.id }, { onSuccess: refresh, onError: e => setError(e instanceof Error ? e.message : 'Sesi tidak dapat dihapus.') }); }}><X size={16} /></button></div>)}</div> : <Empty title="Belum ada sesi terhubung" text="Tambahkan sesi untuk mulai pairing melalui QR atau kode." />}
    <form className="add-session-form" onSubmit={e => { e.preventDefault(); create.mutate({ data: { label } }, { onSuccess: s => { setLabel(''); setSelected(s.id); refresh(); connectSession(s.id); }, onError: err => setError(err instanceof Error ? err.message : 'Sesi tidak dapat dibuat.') }); }}><div className="add-session-label"><Plus size={16} /> Tambahkan sesi baru</div><div className="inline-form"><input required maxLength={40} value={label} onChange={e => setLabel(e.target.value)} placeholder="Contoh: Tim Bandung" aria-label="Nama sesi" /><button className="button button-primary" disabled={create.isPending}><Plus size={15} /> Buat sesi</button></div></form>
  </section><aside className="pairing-column"><section className="panel pairing-panel"><div className="pair-eyebrow"><span /> PAIRING DEVICE</div><h2>Hubungkan<br />WhatsApp Anda</h2><p>Gunakan QR atau kode pairing untuk menghubungkan sesi dengan aman.</p><div className="pair-tabs"><button onClick={() => { setMode('qr'); setAuthData(null); }} className={mode === 'qr' ? 'pair-tab active' : 'pair-tab'}>Kode QR</button><button onClick={() => { setMode('pairing_code'); setAuthData(null); }} className={mode === 'pairing_code' ? 'pair-tab active' : 'pair-tab'}>Kode nomor</button></div>{mode === 'pairing_code' && <label className="pair-input-label">Nomor WhatsApp<input value={phone} onChange={e => setPhone(e.target.value)} placeholder="62812xxxxxxxx" /></label>}
    <div className="qr-box">{authData?.qrDataUrl ? <img className="qr-image" src={authData.qrDataUrl} alt="Kode QR WhatsApp untuk pairing" /> : authData?.pairingCode ? <div className="pairing-code">{authData.pairingCode}</div> : <div className="qr-placeholder"><QrCode size={42} /><span>{selected ? 'Siap dipindai dari WhatsApp' : 'Pilih sesi untuk mulai pairing'}</span></div>}</div>{error && <div className="inline-error"><CircleAlert size={15} /> {error}</div>}<button className="button button-primary connect-button" disabled={!selected || connect.isPending || (mode === 'pairing_code' && !phone)} onClick={() => connectSession(selected)}>{connect.isPending ? 'Menyiapkan pairing...' : authData ? 'Muat ulang kode' : 'Mulai pairing'}<ArrowUpRight size={15} /></button><div className="qr-instructions"><span>01</span><p>Buka WhatsApp di ponsel Anda</p><span>02</span><p>Pilih <b>Perangkat tertaut</b> lalu pindai kode</p></div></section><div className="safe-note"><ShieldCheck size={16} /><p><b>Sesi terkendali</b><br />Kami tidak menggunakan rotasi akun otomatis. Setiap sesi dikelola terpisah.</p></div></aside></div>;
}

function BlastPage({ role }: { role: string }) {
  const qc = useQueryClient(); const active = useGetActiveCampaign(); const sessions = useListWaSessions(); const current = useGetCurrentBlast({ query: { refetchInterval: 5000, queryKey: getGetCurrentBlastQueryKey() } }); const [delay, setDelay] = useState(30); const [error, setError] = useState('');
  const start = useStartBlast(); const cancel = useCancelBlast(); const refresh = () => { qc.invalidateQueries({ queryKey: getGetCurrentBlastQueryKey() }); qc.invalidateQueries({ queryKey: getGetDashboardOverviewQueryKey() }); qc.invalidateQueries({ queryKey: getListResultsQueryKey() }); };
  const campaign = active.data?.campaign; const job = current.data?.job; const online = sessions.data?.filter(s => s.status === 'online') || [];
  const progress = job?.total ? Math.min(100, Math.round(((job.sent + job.failed) / job.total) * 100)) : 0;
  if (active.isLoading || sessions.isLoading || current.isLoading) return <LoadingBlock />;
  return <div className="blast-layout"><section className="blast-main"><div className="panel blast-campaign-card"><div className="campaign-card-top"><div className="campaign-mark"><MessageCircle size={20} /></div><span className="active-campaign-tag"><i /> KAMPANYE TERPILIH ADMIN</span></div>{campaign ? <><h2>{campaign.title}</h2><p>{campaign.messageText}</p><div className="blast-campaign-meta"><span><Users size={15} /> {campaign.contactTotal.toLocaleString('id-ID')} kontak consent</span><span><ShieldCheck size={15} /> Consent aktif diperiksa sebelum kirim</span></div></> : <Empty title="Belum ada kampanye aktif" text="Administrator belum memilih kampanye untuk dikirim." />}</div>
     {job && <section className="panel progress-panel"><div className="progress-heading"><div><div className="eyebrow">STATUS PEKERJAAN</div><h3>Pengiriman sedang {job.status === 'running' ? 'berjalan' : 'berakhir'}</h3></div><Status value={job.status} /></div><div className="progress-number">{progress}<span>%</span><small>{job.sent + job.failed} dari {job.total} diproses</small></div><div className="progress-track"><i style={{ width: `${progress}%` }} /></div><div className="progress-breakdown"><span><b className="sent-count">{job.sent}</b> Terkirim</span><span><b className="fail-count">{job.failed}</b> Gagal</span><span><b>{job.pending}</b> Menunggu</span><span>Saldo berjalan {money(job.runningBalance)}</span><span>Mulai {date(job.startedAt)}</span></div>{job.sessions.length > 0 && <div className="session-list">{job.sessions.map(session => <div className="session-row" key={session.waSessionId}><span className="session-icon"><Smartphone size={15} /></span><span className="session-copy"><b>{session.phone || session.waSessionId}</b><span>{session.sent} terkirim · {session.failed} gagal</span></span><Status value={session.status} /></div>)}</div>}</section>}
    <div className="panel blast-controls">
       <SectionTitle title="Konfigurasi pengiriman" detail="Setiap sesi online akan menjadi pekerja mandiri." />
       <label className="form-label">Sesi yang akan mengirim</label>
       <div className="session-select-grid">
         {online.length ? online.map(s => <div key={s.id} className="select-session">
           <span className="radio-dot" /><span><b>{s.label}</b><small>{s.phone || 'Nomor terhubung'}</small></span><Status value={s.status} />
         </div>) : <div className="no-session"><Smartphone size={17} /><span>Tidak ada sesi online.</span><Link href="/whatsapp">Hubungkan sesi <ArrowUpRight size={13} /></Link></div>}
       </div>
      <label className="form-label delay-label">Jeda antar pesan</label>
      <div className="delay-picker">{[1, 5, 15, 30].map(n => <button key={n} onClick={() => setDelay(n)} className={delay === n ? 'delay-option chosen' : 'delay-option'}><b>{n}</b><span>detik</span>{delay === n && <Check size={14} />}</button>)}</div>
      {error && <div className="inline-error"><CircleAlert size={15} /> {error}</div>}
      <div className="blast-actions">
         {job?.status === 'running' ? <button className="button button-danger" disabled={cancel.isPending} onClick={() => { if (window.confirm('Hentikan blast sekarang? Kontak yang belum terkirim akan kembali ke antrean.')) cancel.mutate(undefined, { onSuccess: refresh, onError: e => setError(e instanceof Error ? e.message : 'Pengiriman tidak dapat dibatalkan.') }); }}><Ban size={16} /> Batalkan pengiriman</button> : role === 'admin' ? <div className="admin-no-start"><ShieldCheck size={15} /> Administrator mengelola aktivasi di Kampanye.</div> : <button className="button button-primary button-wide" disabled={!campaign || online.length === 0 || start.isPending} onClick={() => { setError(''); start.mutate({ data: { delaySeconds: delay as 1 | 5 | 15 | 30 } }, { onSuccess: refresh, onError: e => setError(e instanceof Error ? e.message : 'Pengiriman tidak dapat dimulai.') }); }}>{start.isPending ? 'Memulai pengiriman...' : 'Mulai kirim kampanye'}<ArrowUpRight size={16} /></button>}
      </div>
   </div>
   </section><aside className="blast-aside"><div className="panel blast-policy"><div className="policy-stamp"><ShieldCheck size={20} /></div><div className="eyebrow">PENGIRIMAN AMAN</div><h3>Consent lebih<br />dulu, selalu.</h3><p>Hanya kontak yang belum mencabut persetujuan dapat diproses.</p><div className="policy-divider" /><div className="policy-item"><CheckCircle2 size={16} /><span>Pemeriksaan consent di server</span></div><div className="policy-item"><CheckCircle2 size={16} /><span>Satu pekerja untuk setiap sesi online</span></div><div className="policy-item"><CheckCircle2 size={16} /><span>Jeda 1, 5, 15, atau 30 detik</span></div><div className="policy-item policy-muted"><Ban size={15} /><span>Kontak diklaim satu kali dari pool bersama</span></div></div><div className="blast-help"><Clock3 size={17} /><p><b>Catatan operasional</b><br />Biarkan tab terbuka untuk memantau perubahan progres terbaru.</p></div></aside></div>;
}

function ResultsPage({ role, userId }: { role: string; userId: string }) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [campaignId, setCampaignId] = useState('');
  const [filterUserId, setFilterUserId] = useState('');
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const resultUserId = role === 'admin' ? filterUserId : userId;
  const downloadResults = async (format: 'csv' | 'xlsx') => {
    setExporting(true); setExportError('');
    try {
      const query = new URLSearchParams({ format });
      if (campaignId) query.set('campaignId', campaignId);
      if (status !== 'all') query.set('status', status);
      if (search.trim()) query.set('search', search.trim());
      if (resultUserId) query.set('userId', resultUserId);
      const token = await getAccessToken();
      const response = await fetch(`/api/results/export?${query}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
      if (!response.ok) throw new Error('File hasil tidak dapat dibuat.');
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `hasil-campaign.${format}`; anchor.click(); URL.revokeObjectURL(url);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Ekspor gagal.');
    } finally { setExporting(false); }
  };
  const params = useMemo(() => ({
    ...(campaignId ? { campaignId } : {}),
    ...(status !== 'all' ? { status: status as 'sent' | 'failed' | 'pending' | 'unsent' } : {}),
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    ...(resultUserId ? { userId: resultUserId } : {}),
    page,
    pageSize: 12,
  }), [campaignId, status, debouncedSearch, resultUserId, page]);
  const summaryParams = useMemo(() => ({
    ...(campaignId ? { campaignId } : {}),
    ...(resultUserId ? { userId: resultUserId } : {}),
  }), [campaignId, resultUserId]);
  const results = useListResults(params, { query: { queryKey: getListResultsQueryKey(params) } });
  const summary = useGetResultsSummary(summaryParams, { query: { queryKey: getGetResultsSummaryQueryKey(summaryParams) } });
  const campaigns = useListCampaigns({
    query: { queryKey: getListCampaignsQueryKey(), enabled: role === 'admin' },
  });
  const campaignSummaries = useListCampaignResultSummaries();
  const usersParams = useMemo(() => ({}), []);
  const users = useListUsers(usersParams, {
    query: { queryKey: getListUsersQueryKey(usersParams), enabled: role === 'admin' },
  });
  const campaignOptions = role === 'admin'
    ? campaigns.data
    : campaignSummaries.data?.map(item => item.campaign);
  const statuses = [{ v: 'all', l: 'Semua status' }, { v: 'sent', l: 'Terkirim' }, { v: 'failed', l: 'Gagal' }, { v: 'pending', l: 'Menunggu' }, { v: 'unsent', l: 'Belum dikirim' }];
  const columnCount = role === 'admin' ? 6 : 5;
  return <>
    <div className="metrics-grid results-metrics">
      <Metric label="Diproses" value={summary.data?.totalProcessed ?? '—'} hint="Kontak terproses" icon={Activity} />
      <Metric label="Terkirim" value={summary.data?.sent ?? '—'} hint={`${summary.data?.successRate ?? 0}% tingkat berhasil`} icon={CheckCircle2} tone="mint" />
      <Metric label="Gagal" value={summary.data?.failed ?? '—'} hint="Butuh tinjauan" icon={CircleAlert} tone="rose" />
      <Metric label="Menunggu" value={summary.data?.pending ?? '—'} hint="Dalam antrean" icon={Clock3} tone="gold" />
    </div>
    <section className="panel results-panel">
      <SectionTitle title="Catatan pengiriman" detail={`${results.data?.total ?? 0} hasil sesuai filter`} action={<div style={{ display: 'flex', gap: 7 }}><button className="button button-secondary button-small" disabled={exporting} onClick={() => void downloadResults('csv')}><Download size={13} /> CSV</button><button className="button button-secondary button-small" disabled={exporting} onClick={() => void downloadResults('xlsx')}><Download size={13} /> XLSX</button></div>} />
      {exportError && <div className="inline-error"><CircleAlert size={14} /> {exportError}</div>}
      <div className="filter-bar">
        <div className="search-field"><Search size={16} /><input aria-label="Cari nomor kontak" placeholder="Cari nomor kontak..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} /></div>
        <select aria-label="Filter status" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}>{statuses.map(item => <option value={item.v} key={item.v}>{item.l}</option>)}</select>
        <select aria-label="Filter kampanye" value={campaignId} onChange={e => { setCampaignId(e.target.value); setPage(1); }}><option value="">Semua kampanye</option>{campaignOptions?.map(campaign => <option key={campaign.id} value={campaign.id}>{campaign.title}</option>)}</select>
        {role === 'admin' && <select aria-label="Filter customer" value={filterUserId} onChange={e => { setFilterUserId(e.target.value); setPage(1); }}><option value="">Semua pengirim</option>{users.data?.map(customer => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select>}
      </div>
      <div className="table-scroll"><table>
        <thead><tr><th>Nomor kontak</th>{role === 'admin' && <th>Pengirim</th>}<th>Kampanye</th><th>Status</th><th>Nomor sesi</th><th>Waktu</th></tr></thead>
        <tbody>{results.isLoading
          ? <tr><td colSpan={columnCount}><span className="table-loading">Memuat catatan...</span></td></tr>
          : results.data?.items?.length
            ? results.data.items.map(row => <tr key={row.id}><td className="mono">{row.phone}</td>{role === 'admin' && <td>{row.customerName || '—'}</td>}<td>{row.campaignTitle}</td><td><Status value={row.status} />{row.errorReason && <small className="error-reason">{row.errorReason}</small>}</td><td className="mono">{row.senderPhone || '—'}</td><td>{date(row.sentAt)}</td></tr>)
            : <tr><td colSpan={columnCount}><Empty title="Tidak ada hasil ditemukan" text="Ubah filter atau cari data lain." /></td></tr>}
        </tbody>
      </table></div>
      <div className="table-footer"><span>Halaman {page} · {results.data?.total ?? 0} catatan</span><div><button className="button button-secondary button-small" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Sebelumnya</button><button className="button button-secondary button-small" disabled={!results.data || page * results.data.pageSize >= results.data.total} onClick={() => setPage(p => p + 1)}>Berikutnya</button></div></div>
    </section>
    {campaignSummaries.data?.length ? <section className="panel campaign-summary"><SectionTitle title="Ringkasan per kampanye" detail="Rangkuman hasil kampanye Anda" />{campaignSummaries.data.map((item, index) => <div className="summary-row" key={item.campaign.id}><span className="summary-index">0{index + 1}</span><b>{item.campaign.title}</b><span>{item.summary.sent} terkirim</span><Status value={item.campaign.status} /></div>)}</section> : null}
  </>;
}

function WalletPage() {
  const wallet = useGetWallet(); if (wallet.isLoading) return <LoadingBlock />; if (wallet.isError) return <ErrorBlock retry={() => wallet.refetch()} />; const w = wallet.data;
  return <><div className="wallet-hero"><div className="wallet-heading"><div className="eyebrow">RINGKASAN DOMPET</div><h2>Saldo tumbuh dari<br />pengiriman terverifikasi.</h2><p>Penghasilan blast dipindahkan saat pekerjaan selesai atau dihentikan.</p></div><div className="wallet-balance"><span>SALDO UTAMA</span><b>{money(w?.mainBalance)}</b><small><i /> Tersedia untuk penarikan</small></div><div className="wallet-lines"><span /><span /><span /></div></div><div className="metrics-grid wallet-metrics"><Metric label="Saldo berjalan" value={money(w?.runningBalance)} hint="Dari blast yang masih berjalan" icon={Clock3} tone="gold" /><Metric label="Saldo tertunda lama" value={money(w?.pendingBalance)} hint="Saldo dari transaksi lama" icon={Clock3} tone="gold" /><Metric label="Total pendapatan" value={money(w?.lifetimeEarnings)} hint={`Tarif ${money(w?.perMessage)} per pesan`} icon={TrendingUp} tone="mint" /><Metric label="Pendapatan referral" value={money(w?.referralEarnings)} hint="Bonus langsung ke saldo utama" icon={Users} tone="blue" /></div><section className="panel transactions-panel"><SectionTitle title="Riwayat transaksi" detail="Seluruh mutasi dompet Anda" action={<span className="secure-badge"><ShieldCheck size={13} /> Terlindungi</span>} /><div className="transaction-list">{w?.transactions?.length ? w.transactions.map(t => <div className="transaction-row" key={t.id}><div className={`transaction-icon tx-${t.type}`}>{t.type === 'withdrawal' ? <ArrowUpRight size={17} /> : t.type === 'referral' ? <Users size={17} /> : <ArrowDownLeft size={17} />}</div><div className="transaction-copy"><b>{t.description}</b><span>{date(t.createdAt)} · <Status value={t.status} /></span></div><div className={`transaction-amount ${t.type === 'withdrawal' ? 'amount-out' : ''}`}>{t.type === 'withdrawal' ? '−' : '+'}{money(t.amount)}</div></div>) : <Empty title="Belum ada transaksi" text="Pendapatan dari pengiriman akan tercatat di sini." />}</div></section></>;
}

function ReferralsPage() {
  const q = useGetReferrals();
  const [copied, setCopied] = useState(false);
  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <ErrorBlock retry={() => q.refetch()} />;
  const r = q.data;
  const basePath = window.location.pathname.replace(/\/[^/]*$/, '');
  const referralUrl = r?.code
    ? `${window.location.origin}${basePath}/register?ref=${encodeURIComponent(r.code)}`
    : '';
  return <>
    <div className="referral-hero">
      <div className="referral-copy"><div className="eyebrow">PROGRAM REFERRAL</div><h2>Bagikan kepercayaan,<br /><em>tumbuh bersama.</em></h2><p>Dapatkan bonus dari setiap pesan terverifikasi yang dikirim jaringan Anda.</p></div>
      <div className="referral-code"><span>KODE UNDANGAN ANDA</span><b>{r?.code || '—'}</b>{referralUrl && <a className="referral-link" href={referralUrl}>{referralUrl}</a>}<button disabled={!referralUrl} onClick={() => { if (referralUrl) navigator.clipboard?.writeText(referralUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }); }}><Copy size={14} /> {copied ? 'Tersalin' : 'Salin tautan'}</button></div>
      <div className="referral-decoration"><Link2 size={33} /></div>
    </div>
    <div className="metrics-grid"><Metric label="Jumlah downline" value={r?.downlineCount ?? 0} hint="Customer yang bergabung" icon={Users} tone="blue" /><Metric label="Pendapatan referral" value={money(r?.totalEarnings)} hint={`Bonus ${money(r?.bonusPerMessage)} per pesan`} icon={TrendingUp} tone="mint" /><Metric label="Bonus per pesan" value={money(r?.bonusPerMessage)} hint="Setiap pesan berhasil" icon={Sparkles} tone="gold" /></div>
    <section className="panel downline-panel"><SectionTitle title="Jaringan Anda" detail="Performa customer yang menggunakan kode Anda" />{r?.downlines?.length ? <div className="table-scroll"><table><thead><tr><th>Nama customer</th><th>Bergabung</th><th>Pesan terkirim</th><th>Pendapatan referral</th></tr></thead><tbody>{r.downlines.map((d, i) => <tr key={`${d.name}-${i}`}><td><span className="downline-name"><span className="avatar avatar-small">{d.name.slice(0, 1)}</span><b>{d.name}</b></span></td><td>{date(d.joinedAt)}</td><td>{d.sentCount.toLocaleString('id-ID')}</td><td className="money-cell">{money(d.earnings)}</td></tr>)}</tbody></table></div> : <Empty title="Belum ada downline" text="Bagikan kode referral untuk mulai membangun jaringan." />}</section>
  </>;
}

function WithdrawalsPage({ role }: { role: string }) {
  const q = useListWithdrawals();
  const wallet = useGetWallet();
  const create = useRequestWithdrawal();
  const update = useUpdateWithdrawal();
  const qc = useQueryClient();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'bank' | 'ewallet'>('bank');
  const [accountName, setAccountName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [error, setError] = useState('');
  const refresh = () => {
    qc.invalidateQueries({ queryKey: getListWithdrawalsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetWalletQueryKey() });
  };
  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <ErrorBlock retry={() => q.refetch()} />;

  const reject = (withdrawalId: string) => {
    const note = window.prompt('Alasan penolakan (wajib):');
    if (!note?.trim()) return;
    update.mutate(
      { withdrawalId, data: { status: 'rejected', note: note.trim() } },
      { onSuccess: refresh },
    );
  };
  const accept = (withdrawalId: string) => {
    if (!window.confirm('Konfirmasi bahwa transfer manual sudah berhasil dilakukan?')) return;
    update.mutate(
      { withdrawalId, data: { status: 'paid' } },
      { onSuccess: refresh },
    );
  };

  return <div className="withdrawal-layout">
    <section className="panel withdrawal-form-panel">
      <div className="withdrawal-form-head"><div className="eyebrow">PENCAIRAN DANA</div><h2>Ajukan penarikan</h2><p>Permintaan diproses secara manual oleh administrator.</p></div>
      <div className="available-balance"><span>Saldo tersedia</span><b>{money(wallet.data?.mainBalance)}</b></div>
      {role === 'admin' ? <div className="admin-note"><ShieldCheck size={17} /> Permintaan penarikan customer dikelola dari daftar berikut.</div> :
        <form onSubmit={e => { e.preventDefault(); setError(''); create.mutate({ data: { amount: Number(amount), method, accountName, accountNumber } }, { onSuccess: () => { setAmount(''); setAccountName(''); setAccountNumber(''); refresh(); }, onError: err => setError(err instanceof Error ? err.message : 'Permintaan tidak dapat dikirim.') }); }} className="withdrawal-form">
          <label>Jumlah penarikan<input required type="number" min={wallet.data?.minimumWithdrawal || 15000} max={wallet.data?.mainBalance || undefined} step="1000" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Contoh: 150000" /><small>Minimum {money(wallet.data?.minimumWithdrawal)}</small></label>
          <label>Metode pencairan<select value={method} onChange={e => setMethod(e.target.value as 'bank' | 'ewallet')}><option value="bank">Transfer bank</option><option value="ewallet">Dompet digital</option></select></label>
          <label>Nama pemilik rekening<input required minLength={2} value={accountName} onChange={e => setAccountName(e.target.value)} placeholder="Nama sesuai rekening" /></label>
          <label>Nomor rekening / akun<input required minLength={6} value={accountNumber} onChange={e => setAccountNumber(e.target.value)} placeholder="Masukkan nomor rekening" /></label>
          {error && <div className="inline-error"><CircleAlert size={15} /> {error}</div>}
          <button className="button button-primary button-wide" disabled={create.isPending}>{create.isPending ? 'Mengirim permintaan...' : 'Ajukan penarikan'}<ArrowUpRight size={15} /></button>
        </form>}
    </section>
    <section className="panel withdrawals-list">
      <SectionTitle title={role === 'admin' ? 'Semua permintaan' : 'Riwayat penarikan'} detail={`${q.data?.length || 0} permintaan`} />
      {q.data?.length ? q.data.map(w => <div className="withdrawal-row" key={w.id}>
        <div className="withdrawal-icon"><CreditCard size={17} /></div>
        <div className="withdrawal-copy"><b>{money(w.amount)}</b><span>{w.method === 'bank' ? 'Transfer bank' : 'Dompet digital'} · {w.accountName} · {w.accountNumberMasked}</span><small>{date(w.createdAt)}{w.note ? ` · ${w.note}` : ''}</small></div>
        <div className="withdrawal-status"><Status value={w.status} />
          {role === 'admin' && w.status === 'pending' && <div className="review-actions">
            <button title="Mulai proses" disabled={update.isPending} onClick={() => update.mutate({ withdrawalId: w.id, data: { status: 'approved' } }, { onSuccess: refresh })}><Check size={14} /><span>Proses</span></button>
            <button title="Tolak" disabled={update.isPending} onClick={() => reject(w.id)}><X size={14} /><span>Tolak</span></button>
          </div>}
          {role === 'admin' && w.status === 'approved' && <button className="button button-primary button-small" disabled={update.isPending} onClick={() => accept(w.id)}>Accept</button>}
        </div>
      </div>) : <Empty title="Belum ada permintaan" text="Permintaan penarikan akan tampil di sini." />}
    </section>
  </div>;
}

function CampaignsPage() {
  const q = useListCampaigns(); const create = useCreateCampaign(); const update = useUpdateCampaign(); const remove = useDeleteCampaign(); const activate = useActivateCampaign(); const qc = useQueryClient(); const [editing, setEditing] = useState<Campaign | null>(null); const [creating, setCreating] = useState(false); const [form, setForm] = useState({ title: '', messageText: '', imageUrl: '', ctaText: '', ctaUrl: '' }); const [error, setError] = useState('');
  const refresh = () => { qc.invalidateQueries({ queryKey: getListCampaignsQueryKey() }); qc.invalidateQueries({ queryKey: getGetActiveCampaignQueryKey() }); qc.invalidateQueries({ queryKey: getListContactsQueryKey() }); };
  const openNew = () => { setEditing(null); setForm({ title: '', messageText: '', imageUrl: '', ctaText: '', ctaUrl: '' }); setCreating(true); setError(''); };
  const openEdit = (c: Campaign) => { setEditing(c); setForm({ title: c.title, messageText: c.messageText, imageUrl: c.imageUrl || '', ctaText: c.ctaText || '', ctaUrl: c.ctaUrl || '' }); setCreating(true); setError(''); };
  if (q.isLoading) return <LoadingBlock />; if (q.isError) return <ErrorBlock retry={() => q.refetch()} />;
  return <><section className="panel campaigns-list-panel"><SectionTitle title="Daftar kampanye" detail={`${q.data?.length || 0} kampanye tersimpan`} action={<button className="button button-primary" onClick={openNew}><Plus size={15} /> Buat kampanye</button>} />{q.data?.length ? <div className="campaign-list">{q.data.map(c => <article className={`campaign-row ${c.isActive ? 'campaign-current' : ''}`} key={c.id}><div className="campaign-row-art"><MessageCircle size={20} /><span>{c.isActive ? 'SEDANG AKTIF' : 'KAMPANYE'}</span></div><div className="campaign-row-copy"><div className="campaign-title-row"><h3>{c.title}</h3><Status value={c.status} />{c.isActive && <span className="current-tag">TERPILIH</span>}</div><p>{c.messageText}</p><div className="campaign-stats"><span>{c.contactTotal.toLocaleString('id-ID')} kontak</span><span>{c.sentCount.toLocaleString('id-ID')} terkirim</span><span>{c.failedCount.toLocaleString('id-ID')} gagal</span><span>Dibuat {date(c.createdAt)}</span></div></div><div className="campaign-actions"><button className="button button-secondary button-small" onClick={() => openEdit(c)}>Ubah</button>{!c.isActive && <button className="button button-primary button-small" onClick={() => activate.mutate({ campaignId: c.id }, { onSuccess: refresh, onError: e => setError(e instanceof Error ? e.message : 'Kampanye tidak dapat diaktifkan.') })}>Aktifkan</button>}<button className="icon-button danger-icon" aria-label={`Hapus ${c.title}`} onClick={() => { if (window.confirm(`Hapus kampanye “${c.title}”?`)) remove.mutate({ campaignId: c.id }, { onSuccess: refresh, onError: e => setError(e instanceof Error ? e.message : 'Kampanye tidak dapat dihapus.') }); }}><X size={16} /></button></div></article>)}</div> : <Empty title="Belum ada kampanye" text="Buat kampanye untuk menyiapkan naskah pengiriman." />}{error && <div className="inline-error"><CircleAlert size={15} /> {error}</div>}</section>
  {creating && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setCreating(false); }}><form className="modal-card" onSubmit={e => { e.preventDefault(); setError(''); const body = { title: form.title, messageText: form.messageText, imageUrl: form.imageUrl || null, ctaText: form.ctaText || null, ctaUrl: form.ctaUrl || null }; if (editing) update.mutate({ campaignId: editing.id, data: body }, { onSuccess: () => { setCreating(false); refresh(); }, onError: err => setError(err instanceof Error ? err.message : 'Perubahan tidak tersimpan.') }); else create.mutate({ data: body }, { onSuccess: () => { setCreating(false); refresh(); }, onError: err => setError(err instanceof Error ? err.message : 'Kampanye tidak dapat dibuat.') }); }}><div className="modal-top"><div><div className="eyebrow">KONFIGURASI KAMPANYE</div><h2>{editing ? 'Ubah kampanye' : 'Kampanye baru'}</h2></div><button type="button" className="icon-button" onClick={() => setCreating(false)}><X size={17} /></button></div><label>Nama kampanye<input required minLength={2} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label><label>Naskah pesan<textarea required rows={5} value={form.messageText} onChange={e => setForm({ ...form, messageText: e.target.value })} /></label><div className="form-split"><label>URL gambar <span className="optional">OPSIONAL</span><input type="url" value={form.imageUrl} onChange={e => setForm({ ...form, imageUrl: e.target.value })} placeholder="https://" /></label><label>Teks CTA <span className="optional">OPSIONAL</span><input value={form.ctaText} onChange={e => setForm({ ...form, ctaText: e.target.value })} /></label></div><label>URL CTA <span className="optional">OPSIONAL</span><input type="url" value={form.ctaUrl} onChange={e => setForm({ ...form, ctaUrl: e.target.value })} placeholder="https://" /></label>{error && <div className="inline-error"><CircleAlert size={15} /> {error}</div>}<div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setCreating(false)}>Batal</button><button className="button button-primary" disabled={create.isPending || update.isPending}>{editing ? 'Simpan perubahan' : 'Buat kampanye'}<ArrowUpRight size={15} /></button></div></form></div>}</>;
}

function ContactsPage() {
  const campaigns = useListCampaigns(); const [campaignId, setCampaignId] = useState(''); const [search, setSearch] = useState(''); const [page, setPage] = useState(1); const [importText, setImportText] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const params = useMemo(() => ({ ...(campaignId ? { campaignId } : {}), ...(search ? { search } : {}), page, pageSize: 20 }), [campaignId, search, page]); const contacts = useListContacts(params, { query: { queryKey: getListContactsQueryKey(params) } }); const importer = useImportContacts(); const remove = useDeleteContact(); const qc = useQueryClient();
  const refresh = () => { qc.invalidateQueries({ queryKey: getListContactsQueryKey(params) }); qc.invalidateQueries({ queryKey: getListCampaignsQueryKey() }); };
  const submitImport = () => { setError(''); setNotice(''); const rows = importText.trim().split(/\n/).filter(Boolean).map(line => line.split(',').map(v => v.trim())); const parsed = rows.map(row => ({ phone: row[0] || '', consentSource: row[1] || '', consentAt: row[2] || '' })); if (!campaignId) { setError('Pilih kampanye sebelum mengimpor kontak.'); return; } if (parsed.some(c => !c.phone || !c.consentSource || !c.consentAt || Number.isNaN(new Date(c.consentAt).getTime()))) { setError('Setiap baris harus berisi nomor, sumber consent, dan waktu ISO yang valid.'); return; } importer.mutate({ data: { campaignId, contacts: parsed } }, { onSuccess: result => { setNotice(`${result.added} kontak ditambahkan · ${result.duplicates} duplikat · ${result.invalid} tidak valid · ${result.consentMissing} tanpa consent`); setImportText(''); refresh(); }, onError: e => setError(e instanceof Error ? e.message : 'Impor tidak berhasil.') }); };
  return <><div className="consent-banner"><div className="consent-banner-icon"><ShieldCheck size={20} /></div><div><b>Hanya impor dengan bukti persetujuan</b><p>Sertakan sumber consent dan waktu persetujuan untuk setiap nomor. Kontak tanpa data consent tidak dapat dimasukkan.</p></div><span className="consent-lock">VALIDASI WAJIB</span></div><div className="contacts-layout"><section className="panel import-panel"><SectionTitle title="Impor kontak" detail="Format CSV sederhana, satu kontak per baris." /><label>Kampanye tujuan<select value={campaignId} onChange={e => { setCampaignId(e.target.value); setPage(1); }}><option value="">Pilih kampanye</option>{campaigns.data?.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label><div className="import-format"><span>FORMAT BARIS</span><code>nomor, sumber consent, waktu ISO</code></div><textarea className="import-textarea" value={importText} onChange={e => setImportText(e.target.value)} placeholder={'6281212345678, Formulir situs, 2025-03-12T09:30:00Z'} rows={7} /><div className="import-hint"><CircleHelp size={14} /> Waktu persetujuan harus format tanggal yang dapat dibaca, disarankan ISO 8601.</div>{error && <div className="inline-error"><CircleAlert size={15} /> {error}</div>}{notice && <div className="inline-success"><CheckCircle2 size={15} /> {notice}</div>}<button className="button button-primary button-wide" onClick={submitImport} disabled={importer.isPending || !importText.trim()}><Upload size={15} /> {importer.isPending ? 'Memvalidasi & mengimpor...' : 'Validasi dan impor kontak'}</button></section><section className="panel contacts-list-panel"><SectionTitle title="Daftar kontak" detail={`${contacts.data?.total ?? 0} kontak`} /><div className="filter-bar"><div className="search-field"><Search size={16} /><input placeholder="Cari nomor..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} /></div><select value={campaignId} onChange={e => setCampaignId(e.target.value)}><option value="">Semua kampanye</option>{campaigns.data?.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select></div><div className="table-scroll"><table><thead><tr><th>Nomor</th><th>Status</th><th>Sumber consent</th><th>Persetujuan</th><th /></tr></thead><tbody>{contacts.isLoading ? <tr><td colSpan={5}>Memuat daftar kontak...</td></tr> : contacts.data?.items.length ? contacts.data.items.map((c: Contact) => <tr key={c.id}><td className="mono">{c.phone}</td><td><Status value={c.status} /></td><td>{c.consentSource || '—'}{c.consentRevokedAt && <small className="error-reason">Dicabut {date(c.consentRevokedAt)}</small>}</td><td>{date(c.consentAt)}</td><td><button className="icon-button danger-icon" aria-label={`Hapus kontak ${c.phone}`} onClick={() => { if (window.confirm(`Hapus kontak ${c.phone}?`)) remove.mutate({ contactId: c.id }, { onSuccess: refresh }); }}><X size={15} /></button></td></tr>) : <tr><td colSpan={5}><Empty title="Belum ada kontak" text="Pilih kampanye dan impor kontak ber-consent." /></td></tr>}</tbody></table></div><div className="table-footer"><span>Halaman {page} · {contacts.data?.total ?? 0} kontak</span><div><button className="button button-secondary button-small" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Sebelumnya</button><button className="button button-secondary button-small" disabled={!contacts.data || page * contacts.data.pageSize >= contacts.data.total} onClick={() => setPage(p => p + 1)}>Berikutnya</button></div></div></section></div></>;
}

function CustomersPage() {
  const [search, setSearch] = useState(''); const params = useMemo(() => ({ ...(search ? { search } : {}) }), [search]); const q = useListUsers(params, { query: { queryKey: getListUsersQueryKey(params) } }); const update = useUpdateUserStatus(); const qc = useQueryClient();
  return <section className="panel customers-panel"><SectionTitle title="Akun customer" detail={`${q.data?.length || 0} akun terdaftar`} /><div className="filter-bar"><div className="search-field"><Search size={16} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari nama atau email..." /></div><span className="secure-badge"><Users size={14} /> Pengelolaan akses</span></div><div className="table-scroll"><table><thead><tr><th>Customer</th><th>Referral</th><th>Bergabung</th><th>Pesan terkirim</th><th>Status akun</th><th>Aksi</th></tr></thead><tbody>{q.isLoading ? <tr><td colSpan={6}>Memuat akun customer...</td></tr> : q.data?.length ? q.data.map(u => <tr key={u.id}><td><div className="customer-cell"><span className="avatar avatar-small">{u.name.slice(0, 1)}</span><span><b>{u.name}</b><small>{u.email}</small></span></div></td><td className="mono">{u.referralCode}</td><td>{date(u.createdAt)}</td><td>{u.sentCount.toLocaleString('id-ID')}</td><td><Status value={u.status} /></td><td><button className={`button button-small ${u.status === 'active' ? 'button-secondary' : 'button-primary'}`} onClick={() => update.mutate({ userId: u.id, data: { status: u.status === 'active' ? 'blocked' : 'active' } }, { onSuccess: () => qc.invalidateQueries({ queryKey: getListUsersQueryKey(params) }) })}>{u.status === 'active' ? 'Blokir' : 'Aktifkan'}</button></td></tr>) : <tr><td colSpan={6}><Empty title="Customer tidak ditemukan" text="Coba kata pencarian lain." /></td></tr>}</tbody></table></div></section>;
}

function AdminWaSessionsPage() {
  const q = useListAdminWaSessions({
    query: { queryKey: getListAdminWaSessionsQueryKey(), refetchInterval: 5000 },
  });
  const disconnect = useDisconnectAdminWaSession();
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: getListAdminWaSessionsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetDashboardOverviewQueryKey() });
  };
  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <ErrorBlock retry={() => q.refetch()} />;
  return <section className="panel customers-panel">
    <SectionTitle title="Sesi WhatsApp customer" detail={`${q.data?.length ?? 0} sesi terdaftar`} action={<button className="button button-secondary button-small" onClick={() => q.refetch()}><RotateCw size={13} /> Muat ulang</button>} />
    <div className="table-scroll"><table>
      <thead><tr><th>Pemilik</th><th>Label sesi</th><th>Nomor</th><th>Status</th><th>Terakhir aktif</th><th>Aksi</th></tr></thead>
      <tbody>{q.data?.length ? q.data.map(session => <tr key={session.id}>
        <td><div className="customer-cell"><span className="avatar avatar-small">{session.ownerName.slice(0, 1)}</span><span><b>{session.ownerName}</b><small>{session.ownerEmail}</small></span></div></td>
        <td>{session.label}</td><td className="mono">{session.phone || '—'}</td><td><Status value={session.status} /></td><td>{date(session.lastConnectedAt)}</td>
        <td><button className="button button-secondary button-small" disabled={disconnect.isPending} onClick={() => { if (window.confirm(`Putuskan sesi ${session.label} milik ${session.ownerName}?`)) disconnect.mutate({ sessionId: session.id }, { onSuccess: refresh }); }}><Ban size={13} /> Putuskan</button></td>
      </tr>) : <tr><td colSpan={6}><Empty title="Belum ada sesi" text="Sesi WhatsApp customer akan tercatat di sini." /></td></tr>}</tbody>
    </table></div>
  </section>;
}

function SettingsPage() {
  const q = useGetSettings(); const update = useUpdateSettings(); const qc = useQueryClient(); const [values, setValues] = useState<AppSettings | null>(null); const [saved, setSaved] = useState(false); if (q.isLoading) return <LoadingBlock />; if (q.isError) return <ErrorBlock retry={() => q.refetch()} />;
  const settings = values || q.data; if (!settings) return <Empty title="Pengaturan belum tersedia" text="Coba muat kembali." />;
  return <div className="settings-layout"><section className="panel settings-form-panel"><SectionTitle title="Tarif & batas operasional" detail="Perubahan berlaku untuk perhitungan dan pekerjaan baru." action={<span className="secure-badge"><ShieldCheck size={13} /> Khusus admin</span>} /><div className="settings-fields"><label>Tarif per pesan terkirim<span>Imbalan customer per pesan berhasil</span><div className="setting-input"><span>Rp</span><input type="number" min="0" value={settings.perMessage} onChange={e => { setValues({ ...settings, perMessage: Number(e.target.value) }); setSaved(false); }} /></div></label><label>Bonus referral per pesan<span>Bonus referral dari setiap pesan downline</span><div className="setting-input"><span>Rp</span><input type="number" min="0" value={settings.referralBonus} onChange={e => { setValues({ ...settings, referralBonus: Number(e.target.value) }); setSaved(false); }} /></div></label><label>Minimum penarikan<span>Batas minimum pengajuan pencairan</span><div className="setting-input"><span>Rp</span><input type="number" min="15000" value={settings.minimumWithdrawal} onChange={e => { setValues({ ...settings, minimumWithdrawal: Number(e.target.value) }); setSaved(false); }} /></div></label><label>Waktu rilis saldo tertunda<span>Jam sebelum pendapatan dapat ditarik</span><div className="setting-input"><input type="number" min="0" max="720" value={settings.pendingReleaseHours} onChange={e => { setValues({ ...settings, pendingReleaseHours: Number(e.target.value) }); setSaved(false); }} /><span>jam</span></div></label><label>Batas pesan per sesi per jam<span>Pembatas operasional setiap sesi</span><div className="setting-input"><input type="number" min="1" max="60" value={settings.maxMessagesPerSessionPerHour} onChange={e => { setValues({ ...settings, maxMessagesPerSessionPerHour: Number(e.target.value) }); setSaved(false); }} /><span>pesan / jam</span></div></label><label>Sesi idle sebelum nonaktif<span>Jeda tanpa pengiriman setelah pekerjaan selesai</span><div className="setting-input"><input type="number" min="1" max="1440" value={settings.sessionIdleMinutes} onChange={e => { setValues({ ...settings, sessionIdleMinutes: Number(e.target.value) }); setSaved(false); }} /><span>menit</span></div></label></div><div className="setting-toggle-row"><div><b>Masukkan ulang saat sesi terputus</b><span>Kontak tertunda dapat dipertimbangkan kembali setelah sesi pulih.</span></div><button role="switch" aria-checked={Boolean(settings.allowDisconnectRequeue)} className={`toggle-switch ${settings.allowDisconnectRequeue ? 'toggle-on' : ''}`} onClick={() => { setValues({ ...settings, allowDisconnectRequeue: !settings.allowDisconnectRequeue }); setSaved(false); }}><i /></button></div><div className="settings-save-row">{saved && <span className="inline-success"><CheckCircle2 size={14} /> Pengaturan disimpan</span>}<button className="button button-primary" disabled={update.isPending} onClick={() => update.mutate({ data: settings }, { onSuccess: () => { setSaved(true); qc.setQueryData(getGetSettingsQueryKey(), settings); qc.invalidateQueries({ queryKey: getGetSettingsQueryKey() }); qc.invalidateQueries({ queryKey: getGetWalletQueryKey() }); }, onError: () => setSaved(false) })}>{update.isPending ? 'Menyimpan...' : 'Simpan pengaturan'}<ArrowUpRight size={15} /></button></div></section><aside className="settings-aside"><div className="settings-note"><div className="note-icon"><ShieldCheck size={18} /></div><div className="eyebrow">PRAKTIK TERJAGA</div><h3>Operasi tanpa<br />rotasi otomatis.</h3><p>Sesi WhatsApp tetap dikendalikan oleh pemilik akun. Tidak ada pergantian akun otomatis.</p></div><div className="settings-note light-note"><div className="note-icon"><Activity size={18} /></div><b>Batas pengiriman</b><p>Jeda pengiriman yang tersedia adalah 1, 5, 15, dan 30 detik. Batas per jam ini melengkapi jeda yang dipilih sender.</p></div></aside></div>;
}

function Forbidden() { return <div className="panel empty-panel"><ShieldCheck size={24} /><b>Akses administrator diperlukan</b><span>Halaman ini hanya tersedia untuk administrator.</span><Link href="/" className="button button-secondary">Kembali ke ringkasan</Link></div>; }
function NotFound() { return <div className="panel empty-panel"><FileText size={24} /><b>Halaman tidak ditemukan</b><span>Periksa alamat halaman atau kembali ke ringkasan.</span><Link href="/" className="button button-primary">Kembali ke ringkasan</Link></div>; }

export default App;
