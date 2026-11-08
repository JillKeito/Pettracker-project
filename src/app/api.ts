import { deleteApp, FirebaseApp, initializeApp } from 'firebase/app';
import {
  Auth,
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  getAuth,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  User as FirebaseUser,
} from 'firebase/auth';
import {
  collection,
  doc,
  DocumentData,
  DocumentSnapshot,
  Firestore,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
  writeBatch,
  WriteBatch,
} from 'firebase/firestore';
import { firebaseConfig, isFirebaseConfigured } from '../environments/firebase.config';
import {
  canTransition,
  csvCell,
  DOCUMENT_TYPES,
  isDate,
  isEmail,
  isValidStatus,
  isWeightKg,
  MAX_DOCUMENT_BYTES,
  passwordProblem,
  sniffMime,
} from './rules';

type Row = any;
type Role = 'owner' | 'staff' | 'admin';
export type Profile = {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  must_change_password: boolean;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const fail = (status: number, message: string): never => {
  throw new ApiError(status, message);
};

const pad = (n: number) => String(n).padStart(2, '0');
const stamp = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const today = () => stamp(new Date()).slice(0, 10);
const plain = (value: unknown): unknown => {
  if (value instanceof Timestamp) return stamp(value.toDate());
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
  }
  return value;
};
const norm = (snap: DocumentSnapshot<DocumentData>): Row => ({ id: snap.id, ...(plain(snap.data() ?? {}) as object) });
const byNewest = (a: Row, b: Row) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''));
const text = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const pending = ['request_submitted', 'request_confirmed', 'documents_pending', 'documents_under_review', 'corrections_required'];
const ongoing = ['picked_up', 'in_transit', 'arrived', 'released'];

/**
 * Client-side data layer. It keeps the same call(path, method, body, form, query) shape the
 * screens were written against, but talks to Firebase Authentication and Cloud Firestore.
 * All real enforcement of "who may read or write what" lives in firestore.rules (server side).
 */
export class PetTrackApi {
  private app?: FirebaseApp;
  private auth!: Auth;
  private db!: Firestore;
  private profile: Profile | null = null;

  private init() {
    if (this.app) return;
    if (!isFirebaseConfigured) {
      fail(503, 'Firebase is not configured yet. Paste your project settings into src/environments/firebase.config.ts.');
    }
    this.app = initializeApp(firebaseConfig);
    this.auth = getAuth(this.app);
    this.db = getFirestore(this.app);
  }

  get configured() {
    return isFirebaseConfigured;
  }

  async call(path: string, method = 'GET', body?: Row, form?: FormData, params: Record<string, string> = {}): Promise<Row> {
    this.init();
    try {
      return await this.route(path, method.toUpperCase(), body ?? {}, form, params);
    } catch (e: any) {
      if (e instanceof ApiError) throw e;
      const code = String(e?.code ?? '');
      if (code === 'permission-denied' || code === 'firestore/permission-denied') {
        throw new ApiError(403, 'You do not have permission to perform this action.');
      }
      if (code === 'unavailable' || code === 'auth/network-request-failed') {
        throw new ApiError(503, 'Cannot reach Firebase. Check your internet connection and try again.');
      }
      if (code === 'resource-exhausted') {
        throw new ApiError(429, 'The free Firebase quota for today has been used up. Try again tomorrow.');
      }
      console.error('[PetTrack]', e);
      throw new ApiError(500, 'Something went wrong. Please try again.');
    }
  }

  // ----------------------------------------------------------------------------------------
  private async route(path: string, method: string, b: Row, form: FormData | undefined, q: Record<string, string>): Promise<Row> {
    let m: RegExpMatchArray | null;
    if (path === '/me' && method === 'GET') return this.me();
    if (path === '/login' && method === 'POST') return this.login(b);
    if (path === '/register' && method === 'POST') return this.register(b);
    if (path === '/logout' && method === 'POST') {
      await this.audit('logout', 'user', this.profile?.id);
      this.profile = null;
      await signOut(this.auth);
      return { ok: true };
    }
    const user = this.need();
    if (user.must_change_password && path !== '/password') fail(403, 'Change your temporary password before continuing.');

    if (path === '/password' && method === 'POST') return this.changePassword(user, b);
    if (path === '/profile' && method === 'PUT') return this.saveProfile(user, b);
    if (path === '/dashboard' && method === 'GET') return this.dashboard(user);
    if (path === '/admin/health' && method === 'GET') {
      this.role(user, 'admin');
      return { status: 'ok', database: 'connected', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, php: 'Firebase (Auth + Firestore)' };
    }

    // ---- users (admin)
    if (path === '/users' && method === 'GET') return this.listUsers(user, q);
    if (path === '/users' && method === 'POST') return this.createUser(user, b);
    if ((m = path.match(/^\/users\/([^/]+)\/(activate|deactivate)$/)) && method === 'POST') return this.setActive(user, m[1], m[2] === 'activate');
    if ((m = path.match(/^\/users\/([^/]+)\/reset-password$/)) && method === 'POST') return this.resetPassword(user, m[1]);
    if ((m = path.match(/^\/users\/([^/]+)$/)) && method === 'PUT') return this.updateUser(user, m[1], b);

    // ---- pets
    if (path === '/pets' && method === 'GET') return this.listPets(user);
    if (path === '/pets' && method === 'POST') return this.savePet(user, null, b);
    if ((m = path.match(/^\/pets\/([^/]+)\/vaccinations$/)) && method === 'POST') return this.addVaccination(user, m[1], b);
    if ((m = path.match(/^\/pets\/([^/]+)\/photo$/)) && method === 'POST') return this.petPhoto(user, m[1], form);
    if ((m = path.match(/^\/pets\/([^/]+)$/)) && method === 'GET') return this.getPet(user, m[1]);
    if ((m = path.match(/^\/pets\/([^/]+)$/)) && method === 'PUT') return this.savePet(user, m[1], b);

    // ---- requests
    if (path === '/requests' && method === 'GET') return { items: (await this.visibleRequests(user)).sort(byNewest) };
    if (path === '/requests' && method === 'POST') return this.createRequest(user, b);
    if ((m = path.match(/^\/requests\/([^/]+)\/assignment$/)) && method === 'POST') return this.assign(user, m[1], b);
    if ((m = path.match(/^\/requests\/([^/]+)\/cancel$/)) && method === 'POST') return this.cancel(user, m[1]);
    if ((m = path.match(/^\/requests\/([^/]+)\/status$/)) && method === 'POST') return this.changeStatus(user, m[1], b);
    if ((m = path.match(/^\/requests\/([^/]+)\/documents$/)) && method === 'POST') return this.upload(user, m[1], form);
    if ((m = path.match(/^\/requests\/([^/]+)$/)) && method === 'GET') return this.requestDetail(user, m[1]);

    // ---- documents
    if (path === '/documents' && method === 'GET') return this.listDocuments(user);
    if ((m = path.match(/^\/documents\/([^/]+)\/review$/)) && method === 'POST') return this.review(user, m[1], b);

    // ---- requirements (admin)
    if (path === '/requirements' && method === 'GET') {
      this.role(user, 'admin');
      const items = (await getDocs(collection(this.db, 'requirements'))).docs.map(norm);
      return { items: items.sort((a, c) => Number(c.active) - Number(a.active) || String(a.name).localeCompare(String(c.name))) };
    }
    if (path === '/requirements' && method === 'POST') return this.saveRequirement(user, null, b);
    if ((m = path.match(/^\/requirements\/([^/]+)\/status$/)) && method === 'POST') return this.toggleRequirement(user, m[1], b);
    if ((m = path.match(/^\/requirements\/([^/]+)$/)) && method === 'PUT') return this.saveRequirement(user, m[1], b);

    // ---- schedules
    if (path === '/schedules' && method === 'GET') return { items: (await this.listSchedules(user)).sort((a, c) => String(a.pickup_at).localeCompare(String(c.pickup_at))) };
    if (path === '/schedules' && method === 'POST') return this.createSchedule(user, b);
    if ((m = path.match(/^\/schedules\/([^/]+)$/)) && method === 'GET') return this.scheduleDetail(user, m[1]);
    if ((m = path.match(/^\/schedules\/([^/]+)$/)) && method === 'PUT') return this.updateSchedule(user, m[1], b);

    // ---- notifications, audit, reports
    if (path === '/notifications' && method === 'GET') {
      const snap = await getDocs(query(collection(this.db, 'notifications'), where('user_id', '==', user.id)));
      return { items: snap.docs.map(norm).sort(byNewest).slice(0, 100) };
    }
    if ((m = path.match(/^\/notifications\/([^/]+)\/read$/)) && method === 'POST') {
      const batch = writeBatch(this.db);
      batch.update(doc(this.db, 'notifications', m[1]), { read_at: serverTimestamp() });
      await batch.commit();
      return { ok: true };
    }
    if (path === '/audit' && method === 'GET') {
      this.role(user, 'admin');
      const snap = await getDocs(query(collection(this.db, 'audit_logs'), orderBy('created_at', 'desc'), limit(300)));
      return { items: snap.docs.map(norm) };
    }
    if (path === '/reports/requests' && method === 'GET') {
      this.role(user, 'admin');
      return { items: (await this.reportRows(q)).slice(0, 1000) };
    }
    if (path === '/reports/stats' && method === 'GET') return this.reportStats(user);
    fail(404, 'Page or action not found.');
    return {};
  }

  // ---------------------------------------------------------------------------- helpers
  private need(): Profile {
    if (!this.profile) fail(401, 'Please sign in to continue.');
    return this.profile!;
  }
  private role(user: Profile, ...roles: Role[]) {
    if (!roles.includes(user.role)) {
      void this.audit('access_denied', 'route', undefined, 'denied', { role: user.role, required: roles });
      fail(403, 'You do not have permission to perform this action.');
    }
  }
  private publicUser(p: Profile) {
    return { id: p.id, name: p.name, email: p.email, role: p.role, must_change_password: p.must_change_password };
  }
  private async loadProfile(fb: FirebaseUser): Promise<Profile | null> {
    const snap = await getDoc(doc(this.db, 'users', fb.uid));
    if (!snap.exists()) return null;
    const d = snap.data();
    return { id: fb.uid, name: d['name'], email: d['email'], role: d['role'], active: d['active'] === true, must_change_password: d['must_change_password'] === true };
  }
  private audit(action: string, type = '', id?: string | null, outcome = 'success', meta: Row = {}, batch?: WriteBatch) {
    if (!this.profile) return Promise.resolve();
    const entry = {
      actor_user_id: this.profile.id,
      actor_name: this.profile.name,
      action,
      record_type: type,
      record_id: id ?? null,
      outcome,
      metadata_json: JSON.stringify(meta).slice(0, 1000),
      created_at: serverTimestamp(),
    };
    const ref = doc(collection(this.db, 'audit_logs'));
    if (batch) {
      batch.set(ref, entry);
      return Promise.resolve();
    }
    return setDoc(ref, entry).catch((e) => console.error('[PetTrack audit]', e));
  }
  private notify(batch: WriteBatch, userId: string | null | undefined, title: string, message: string, type = '', id = '') {
    if (!userId) return;
    batch.set(doc(collection(this.db, 'notifications')), {
      user_id: userId,
      created_by: this.profile!.id,
      title: title.slice(0, 200),
      message: message.slice(0, 1000),
      record_type: type,
      record_id: id,
      read_at: null,
      created_at: serverTimestamp(),
    });
  }

  // ------------------------------------------------------------------------------- auth
  private async me() {
    await this.auth.authStateReady();
    const fb = this.auth.currentUser;
    if (!fb) return { user: null, csrf: '', signup_enabled: true };
    const profile = await this.loadProfile(fb);
    if (!profile || !profile.active) {
      await signOut(this.auth);
      return { user: null, csrf: '', signup_enabled: true };
    }
    this.profile = profile;
    return { user: this.publicUser(profile), csrf: '', signup_enabled: true };
  }

  private async login(b: Row) {
    const email = text(b['email'], 190).toLowerCase();
    const password = String(b['password'] ?? '');
    if (!isEmail(email) || !password) fail(401, 'Email or password is incorrect.');
    let cred;
    try {
      cred = await signInWithEmailAndPassword(this.auth, email, password);
    } catch (e: any) {
      if (e?.code === 'auth/too-many-requests') fail(429, 'Too many failed attempts. Try again in a few minutes.');
      if (e?.code === 'auth/network-request-failed') fail(503, 'Cannot reach Firebase. Check your internet connection.');
      return fail(401, 'Email or password is incorrect.'); // same message for unknown email and wrong password
    }
    const profile = await this.loadProfile(cred.user);
    if (!profile || !profile.active) {
      await signOut(this.auth);
      fail(401, profile ? 'This account has been deactivated. Contact your administrator.' : 'This account is not set up for PetTrack. Contact your administrator.');
    }
    this.profile = profile;
    await this.audit('login_succeeded', 'user', profile!.id);
    return { user: this.publicUser(profile!), csrf: '' };
  }

  private async register(b: Row) {
    if (text(b['website'], 50) !== '') fail(422, 'Sign-up could not be completed.'); // honeypot
    const name = text(b['name'], 120);
    const email = text(b['email'], 190).toLowerCase();
    const password = String(b['password'] ?? '');
    if (name.length < 2 || !isEmail(email)) fail(422, 'Enter your full name and a valid email address.');
    if (b['password_confirm'] !== undefined && b['password_confirm'] !== password) fail(422, 'The two passwords do not match.');
    const problem = passwordProblem(password, email, name);
    if (problem) fail(422, problem);
    let cred;
    try {
      cred = await createUserWithEmailAndPassword(this.auth, email, password);
    } catch (e: any) {
      if (e?.code === 'auth/email-already-in-use') fail(409, 'That email address is already registered. Try signing in instead.');
      if (e?.code === 'auth/weak-password') fail(422, 'That password is too weak. Follow the password rules shown.');
      if (e?.code === 'auth/operation-not-allowed') fail(503, 'Email/password sign-in is not enabled in your Firebase project yet.');
      if (e?.code === 'auth/too-many-requests') fail(429, 'Too many attempts. Try again later.');
      throw e;
    }
    try {
      // Always an OWNER account. firestore.rules rejects any other role on self-created profiles.
      await setDoc(doc(this.db, 'users', cred.user.uid), {
        name, email, role: 'owner', active: true, must_change_password: false, created_at: serverTimestamp(),
      });
    } catch (e) {
      await cred.user.delete().catch(() => undefined);
      throw e;
    }
    this.profile = { id: cred.user.uid, name, email, role: 'owner', active: true, must_change_password: false };
    const batch = writeBatch(this.db);
    void this.audit('account_registered', 'user', cred.user.uid, 'success', { role: 'owner', self_service: true }, batch);
    this.notify(batch, cred.user.uid, 'Welcome to PetTrack', 'Your account is ready. Add your pet profile to start a relocation request.', 'user', cred.user.uid);
    await batch.commit().catch((e) => console.error(e));
    return { user: this.publicUser(this.profile), csrf: '' };
  }

  private async changePassword(user: Profile, b: Row) {
    const current = String(b['current_password'] ?? '');
    const next = String(b['new_password'] ?? '');
    const fb = this.auth.currentUser;
    if (!fb || !current || !next) fail(422, 'Enter your current password and a new password of at least 12 characters.');
    try {
      await reauthenticateWithCredential(fb!, EmailAuthProvider.credential(user.email, current));
    } catch {
      await this.audit('password_change_failed', 'user', user.id, 'denied');
      fail(422, 'Enter your current password and a new password of at least 12 characters.');
    }
    if (next === current) fail(422, 'Choose a new password that is different from the current one.');
    const problem = passwordProblem(next, user.email, user.name);
    if (problem) fail(422, problem);
    await updatePassword(fb!, next);
    const batch = writeBatch(this.db);
    batch.update(doc(this.db, 'users', user.id), { must_change_password: false });
    void this.audit('password_changed', 'user', user.id, 'success', {}, batch);
    await batch.commit();
    user.must_change_password = false;
    return { ok: true, user: this.publicUser(user), csrf: '' };
  }

  private async saveProfile(user: Profile, b: Row) {
    const name = text(b['name'], 120);
    if (name.length < 2) fail(422, 'Enter a valid name.');
    if (text(b['email'], 190).toLowerCase() !== user.email) fail(422, 'Your sign-in email cannot be changed here. Create a new account or ask an administrator.');
    const batch = writeBatch(this.db);
    batch.update(doc(this.db, 'users', user.id), { name });
    void this.audit('profile_updated', 'user', user.id, 'success', {}, batch);
    await batch.commit();
    user.name = name;
    return { ok: true, user: this.publicUser(user) };
  }

  // ------------------------------------------------------------------------------ users
  private async listUsers(user: Profile, q: Record<string, string>) {
    this.role(user, 'admin');
    let items = (await getDocs(collection(this.db, 'users'))).docs.map(norm);
    if (q['role']) items = items.filter((u) => u['role'] === q['role']);
    if (q['active'] === '1' || q['active'] === '0') items = items.filter((u) => (u['active'] === true) === (q['active'] === '1'));
    return { items: items.sort(byNewest).slice(0, Number(q['limit'] ?? 50)), page: 1, limit: Number(q['limit'] ?? 50) };
  }

  private async createUser(user: Profile, b: Row) {
    this.role(user, 'admin');
    const name = text(b['name'], 120);
    const email = text(b['email'], 190).toLowerCase();
    const password = String(b['password'] ?? '');
    const role = String(b['role'] ?? '') as Role;
    if (name.length < 2 || !isEmail(email) || !['owner', 'staff', 'admin'].includes(role)) fail(422, 'Enter a valid name, email, role, and password of at least 12 characters.');
    const problem = passwordProblem(password, email, name);
    if (problem) fail(422, problem);
    // A second, throw-away app instance creates the sign-in without logging the administrator out.
    const second = initializeApp(firebaseConfig, 'account-creator-' + Date.now());
    try {
      const secondAuth = getAuth(second);
      let cred;
      try {
        cred = await createUserWithEmailAndPassword(secondAuth, email, password);
      } catch (e: any) {
        if (e?.code === 'auth/email-already-in-use') fail(409, 'That email address is already in use.');
        throw e;
      }
      const batch = writeBatch(this.db);
      batch.set(doc(this.db, 'users', cred.user.uid), { name, email, role, active: true, must_change_password: true, created_at: serverTimestamp() });
      void this.audit('account_created', 'user', cred.user.uid, 'success', { role }, batch);
      await batch.commit();
      await signOut(secondAuth);
      return { id: cred.user.uid };
    } finally {
      await deleteApp(second);
    }
  }

  private async activeAdmins(): Promise<number> {
    const snap = await getDocs(query(collection(this.db, 'users'), where('role', '==', 'admin')));
    return snap.docs.filter((d) => d.data()['active'] === true).length;
  }

  private async setActive(user: Profile, id: string, active: boolean) {
    this.role(user, 'admin');
    const target = await getDoc(doc(this.db, 'users', id));
    if (!target.exists()) fail(404, 'Account not found.');
    if (!active && target.data()!['role'] === 'admin' && target.data()!['active'] === true && (await this.activeAdmins()) <= 1) {
      fail(409, 'The last active administrator cannot be deactivated.');
    }
    const batch = writeBatch(this.db);
    batch.update(doc(this.db, 'users', id), { active });
    void this.audit(active ? 'account_activated' : 'account_deactivated', 'user', id, 'success', {}, batch);
    await batch.commit();
    return { ok: true };
  }

  private async updateUser(user: Profile, id: string, b: Row) {
    this.role(user, 'admin');
    const name = text(b['name'], 120);
    const role = String(b['role'] ?? '') as Role;
    if (name.length < 2 || !['owner', 'staff', 'admin'].includes(role)) fail(422, 'Enter a valid name and role.');
    const target = await getDoc(doc(this.db, 'users', id));
    if (!target.exists()) fail(404, 'Account not found.');
    const old = target.data()!;
    if (text(b['email'], 190).toLowerCase() !== old['email']) fail(422, 'Sign-in emails cannot be changed. Create a new account instead.');
    if (old['role'] === 'admin' && old['active'] === true && role !== 'admin' && (await this.activeAdmins()) <= 1) {
      fail(409, 'The last active administrator cannot be demoted.');
    }
    const batch = writeBatch(this.db);
    batch.update(doc(this.db, 'users', id), { name, role });
    void this.audit('account_updated', 'user', id, 'success', { old_role: old['role'], new_role: role }, batch);
    await batch.commit();
    return { ok: true };
  }

  private async resetPassword(user: Profile, id: string) {
    this.role(user, 'admin');
    const target = await getDoc(doc(this.db, 'users', id));
    if (!target.exists()) fail(404, 'Account not found.');
    await sendPasswordResetEmail(this.auth, target.data()!['email']);
    await this.audit('password_reset_email_sent', 'user', id);
    return { ok: true };
  }

  // ------------------------------------------------------------------------------- pets
  private async ownedPet(user: Profile, id: string): Promise<Row> {
    const snap = await getDoc(doc(this.db, 'pets', id)).catch(() => null);
    if (!snap || !snap.exists()) return fail(404, 'Pet profile not found.');
    const pet = norm(snap);
    if (user.role === 'owner' && pet['owner_id'] !== user.id) fail(404, 'Pet profile not found.');
    if (user.role === 'staff') fail(403, 'You do not have permission to view pet profiles.');
    return pet;
  }

  private async listPets(user: Profile) {
    if (user.role === 'staff') fail(403, 'You do not have permission to view pet profiles.');
    const col = collection(this.db, 'pets');
    const snap = await getDocs(user.role === 'owner' ? query(col, where('owner_id', '==', user.id)) : col);
    return { items: snap.docs.map(norm).sort(byNewest) };
  }

  private petFields(b: Row) {
    const name = text(b['name'], 120);
    const species = String(b['species'] ?? '');
    if (!name || name.length > 100 || !['Dog', 'Cat', 'Bird', 'Other'].includes(species)) fail(422, 'Enter a pet name and supported species.');
    const birth = text(b['birth_date'], 10);
    if (birth !== '' && (!isDate(birth) || birth > today())) fail(422, 'Enter a valid birth date that is not in the future.');
    const weight = b['weight_kg'];
    if (weight !== null && weight !== undefined && weight !== '' && !isWeightKg(weight)) fail(422, 'Enter a weight between 0 and 500 kg.');
    return {
      name,
      species,
      breed: text(b['breed'], 100),
      sex: ['Female', 'Male'].includes(b['sex']) ? b['sex'] : null,
      birth_date: birth || null,
      color: text(b['color'], 100),
      weight_kg: weight === null || weight === undefined || weight === '' ? null : Number(weight),
      health_notes: text(b['health_notes'], 3000),
    };
  }

  private async savePet(user: Profile, id: string | null, b: Row) {
    this.role(user, 'owner');
    const fields = this.petFields(b);
    const batch = writeBatch(this.db);
    if (id) {
      await this.ownedPet(user, id);
      batch.update(doc(this.db, 'pets', id), fields);
      void this.audit('pet_updated', 'pet', id, 'success', {}, batch);
      await batch.commit();
      return { ok: true };
    }
    const ref = doc(collection(this.db, 'pets'));
    batch.set(ref, { ...fields, owner_id: user.id, owner_name: user.name, photo_key: null, photo_data: null, created_at: serverTimestamp() });
    void this.audit('pet_created', 'pet', ref.id, 'success', {}, batch);
    await batch.commit();
    return { id: ref.id };
  }

  private async getPet(user: Profile, id: string) {
    const pet = await this.ownedPet(user, id);
    const vaccinations = (await getDocs(collection(this.db, 'pets', id, 'vaccinations'))).docs.map(norm);
    vaccinations.sort((a, c) => String(c['administered_on'] ?? '').localeCompare(String(a['administered_on'] ?? '')));
    return { pet, vaccinations };
  }

  private async addVaccination(user: Profile, id: string, b: Row) {
    this.role(user, 'owner');
    await this.ownedPet(user, id);
    const vaccine = text(b['vaccine_name'], 200);
    if (!vaccine || vaccine.length > 150) fail(422, 'Enter a vaccine name.');
    const given = text(b['administered_on'], 10);
    const expires = text(b['expires_on'], 10);
    for (const d of [given, expires]) if (d !== '' && !isDate(d)) fail(422, 'Enter valid vaccination dates.');
    if (given && expires && expires < given) fail(422, 'The vaccine expiry date cannot be before it was given.');
    const ref = doc(collection(this.db, 'pets', id, 'vaccinations'));
    const batch = writeBatch(this.db);
    batch.set(ref, { vaccine_name: vaccine, administered_on: given || null, expires_on: expires || null, notes: text(b['notes'], 500), created_at: serverTimestamp() });
    void this.audit('vaccination_added', 'pet_vaccination', ref.id, 'success', {}, batch);
    await batch.commit();
    return { id: ref.id };
  }

  /** Photos are shrunk in the browser to a small JPEG and kept on the pet profile (no Cloud Storage on the free plan). */
  private async petPhoto(user: Profile, id: string, form?: FormData) {
    this.role(user, 'owner');
    await this.ownedPet(user, id);
    const file = form?.get('file');
    if (!(file instanceof File) || file.size < 1 || file.size > 8 * 1024 * 1024) fail(422, 'Choose a pet photo under 8 MB.');
    const bytes = new Uint8Array(await (file as File).arrayBuffer());
    const mime = sniffMime(bytes);
    if (mime !== 'image/jpeg' && mime !== 'image/png') fail(422, 'Pet photos must be JPG or PNG.');
    const bitmap = await createImageBitmap(new Blob([bytes], { type: mime! }));
    const scale = Math.min(1, 320 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    if (dataUrl.length > 60000) fail(422, 'That photo is too detailed. Try a smaller picture.');
    const batch = writeBatch(this.db);
    batch.update(doc(this.db, 'pets', id), { photo_data: dataUrl, photo_key: 'inline' });
    void this.audit('pet_photo_uploaded', 'pet', id, 'success', {}, batch);
    await batch.commit();
    return { ok: true };
  }

  // ---------------------------------------------------------------------------- requests
  private async visibleRequests(user: Profile): Promise<Row[]> {
    const col = collection(this.db, 'requests');
    if (user.role === 'owner') return (await getDocs(query(col, where('owner_id', '==', user.id)))).docs.map(norm);
    if (user.role === 'admin') return (await getDocs(col)).docs.map(norm);
    const [mine, open] = await Promise.all([
      getDocs(query(col, where('assigned_staff_id', '==', user.id))),
      getDocs(query(col, where('assigned_staff_id', '==', null))),
    ]);
    return [...mine.docs, ...open.docs].map(norm);
  }

  private async ownedRequest(user: Profile, id: string): Promise<Row> {
    const snap = await getDoc(doc(this.db, 'requests', id)).catch(() => null);
    if (!snap || !snap.exists()) return fail(404, 'Relocation request not found.');
    const r = norm(snap);
    if (user.role === 'owner' && r['owner_id'] !== user.id) fail(404, 'Relocation request not found.');
    if (user.role === 'staff' && r['assigned_staff_id'] && r['assigned_staff_id'] !== user.id) fail(404, 'Relocation request not found.');
    return r;
  }

  private matches(rule: Row, origin: string, destination: string, type: string) {
    const ok = (want: unknown, have: string) => !want || want === have;
    return rule['active'] === true && ok(rule['origin_province'], origin) && ok(rule['destination_province'], destination) && ok(rule['relocation_type'], type);
  }

  private async createRequest(user: Profile, b: Row) {
    this.role(user, 'owner');
    const pet = await this.ownedPet(user, String(b['pet_id'] ?? '')).catch(() => null);
    if (!pet) fail(422, 'Choose one of your pet profiles.');
    const from = text(b['origin_city'], 200), fp = text(b['origin_province'], 200);
    const to = text(b['destination_city'], 200), tp = text(b['destination_province'], 200);
    const date = String(b['requested_date'] ?? '');
    const type = String(b['relocation_type'] ?? 'ground');
    const en = text(b['emergency_contact_name'], 200), ep = text(b['emergency_contact_phone'], 100);
    if (!from || from.length > 120 || !fp || fp.length > 120 || !to || to.length > 120 || !tp || tp.length > 120 || !['ground', 'air', 'sea', 'other'].includes(type) || !isDate(date) || date < today() || en.length > 120 || ep.length > 40) {
      fail(422, 'Enter valid Philippine route details, relocation type, and a date that is not in the past.');
    }
    const rand = Array.from(crypto.getRandomValues(new Uint8Array(3)), (x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
    const ref = `PTR-${today().slice(2).replaceAll('-', '')}-${rand}`;
    const rules = (await getDocs(collection(this.db, 'requirements'))).docs.map(norm).filter((r) => this.matches(r, fp, tp, type));
    const vaccinations = (await getDocs(collection(this.db, 'pets', pet['id'], 'vaccinations'))).docs.map(norm).slice(0, 30);
    const requestRef = doc(collection(this.db, 'requests'));
    const batch = writeBatch(this.db);
    batch.set(requestRef, {
      reference_no: ref,
      pet_id: pet['id'],
      pet_name: pet['name'],
      owner_id: user.id,
      owner_name: user.name,
      assigned_staff_id: null,
      assigned_staff_name: null,
      origin_city: from, origin_province: fp, destination_city: to, destination_province: tp,
      relocation_type: type,
      pickup_address: text(b['pickup_address'], 250),
      dropoff_address: text(b['dropoff_address'], 250),
      emergency_contact_name: en || null,
      emergency_contact_phone: ep || null,
      requested_date: date,
      preferred_time: text(b['preferred_time'], 20) || null,
      notes: text(b['notes'], 2000),
      status: 'request_submitted',
      vaccinations: vaccinations.map((v) => ({ vaccine_name: v['vaccine_name'], administered_on: v['administered_on'] ?? null, expires_on: v['expires_on'] ?? null })),
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    });
    for (const r of rules) {
      batch.set(doc(collection(this.db, 'requests', requestRef.id, 'checklist')), {
        requirement_id: r['id'], name: r['name'], description: r['description'] ?? '', category: r['category'] ?? 'other',
        is_required: r['is_required'] === true, instructions: r['instructions'] ?? '', validity_guidance: r['validity_guidance'] ?? '',
        relocation_type: r['relocation_type'] ?? null, validity_days: r['validity_days'] ?? null, authority_reference: r['authority_reference'] ?? '',
      });
    }
    batch.set(doc(collection(this.db, 'requests', requestRef.id, 'history')), {
      old_status: null, new_status: 'request_submitted', actor_user_id: user.id, actor_name: user.name, notes: 'Request submitted by pet owner', created_at: serverTimestamp(),
    });
    this.notify(batch, user.id, 'Relocation request submitted', `Request ${ref} has been submitted.`, 'request', requestRef.id);
    void this.audit('request_created', 'relocation_request', requestRef.id, 'success', {}, batch);
    await batch.commit();
    return { id: requestRef.id, reference_no: ref };
  }

  private async requestDocs(requestId: string): Promise<Row[]> {
    return (await getDocs(collection(this.db, 'requests', requestId, 'documents'))).docs.map((d) => ({ ...norm(d), request_id: requestId, id: `${requestId}:${d.id}` })).sort(byNewest);
  }

  private async requestDetail(user: Profile, id: string) {
    const request = await this.ownedRequest(user, id);
    const [checklistSnap, historySnap, docs] = await Promise.all([
      getDocs(collection(this.db, 'requests', id, 'checklist')),
      getDocs(collection(this.db, 'requests', id, 'history')),
      this.requestDocs(id),
    ]);
    const checklist = checklistSnap.docs.map((d) => {
      const item = norm(d);
      const latest = docs.find((x) => x['requirement_snapshot_id'] === d.id);
      return { ...item, request_id: id, document_status: latest?.['review_status'] ?? null, document_valid_until: latest?.['valid_until'] ?? null };
    });
    const history = historySnap.docs.map(norm).sort((a, c) => String(a['created_at']).localeCompare(String(c['created_at'])));
    const document_history = docs.map((d) => ({ ...d, review_feedback: d['review_feedback'] ?? null }));
    return { request, checklist, history, document_history, vaccinations: request['vaccinations'] ?? [] };
  }

  private async assign(user: Profile, id: string, b: Row) {
    this.role(user, 'admin');
    const request = await this.ownedRequest(user, id);
    const staffId = b['staff_id'] ? String(b['staff_id']) : null;
    let staffName: string | null = null;
    if (staffId) {
      const s = await getDoc(doc(this.db, 'users', staffId));
      if (!s.exists() || s.data()['role'] !== 'staff' || s.data()['active'] !== true) fail(422, 'Choose an active relocation staff account.');
      staffName = s.data()!['name'];
    }
    const batch = writeBatch(this.db);
    batch.update(doc(this.db, 'requests', id), { assigned_staff_id: staffId, assigned_staff_name: staffName, updated_at: serverTimestamp() });
    void this.audit('request_assigned', 'relocation_request', id, 'success', { staff_id: staffId }, batch);
    this.notify(batch, staffId, 'Relocation request assigned', `Request ${request['reference_no']} was assigned to you.`, 'request', id);
    await batch.commit();
    return { ok: true };
  }

  private async cancel(user: Profile, id: string) {
    this.role(user, 'owner');
    const request = await this.ownedRequest(user, id);
    if (!['request_submitted', 'request_confirmed'].includes(request['status'])) fail(409, 'This request can no longer be cancelled from the owner account.');
    const batch = writeBatch(this.db);
    batch.update(doc(this.db, 'requests', id), { status: 'cancelled', updated_at: serverTimestamp() });
    batch.set(doc(collection(this.db, 'requests', id, 'history')), {
      old_status: request['status'], new_status: 'cancelled', actor_user_id: user.id, actor_name: user.name, notes: 'Cancelled by pet owner', created_at: serverTimestamp(),
    });
    void this.audit('request_cancelled', 'relocation_request', id, 'success', {}, batch);
    await batch.commit();
    return { ok: true };
  }

  private async allRequiredVerified(requestId: string): Promise<boolean> {
    const [checklist, docs] = await Promise.all([getDocs(collection(this.db, 'requests', requestId, 'checklist')), this.requestDocs(requestId)]);
    return checklist.docs
      .filter((c) => c.data()['is_required'] === true)
      .every((c) => docs.find((d) => d['requirement_snapshot_id'] === c.id)?.['review_status'] === 'verified');
  }

  private async changeStatus(user: Profile, id: string, b: Row) {
    this.role(user, 'staff', 'admin');
    const row = await this.ownedRequest(user, id);
    const next = String(b['status'] ?? '');
    if (!canTransition(row['status'], next)) fail(422, 'That status transition is not allowed.');
    if (next === 'documents_verified' && !(await this.allRequiredVerified(id))) fail(409, 'Required checklist items must be submitted and verified first.');
    const batch = writeBatch(this.db);
    batch.update(doc(this.db, 'requests', id), { status: next, updated_at: serverTimestamp() });
    batch.set(doc(collection(this.db, 'requests', id, 'history')), {
      old_status: row['status'], new_status: next, actor_user_id: user.id, actor_name: user.name, notes: text(b['notes'], 500), created_at: serverTimestamp(),
    });
    this.notify(batch, row['owner_id'], 'Relocation update', `${row['reference_no']} is now ${next.replaceAll('_', ' ')}.`, 'request', id);
    void this.audit('status_changed', 'relocation_request', id, 'success', { from: row['status'], to: next }, batch);
    await batch.commit();
    return { ok: true };
  }

  // --------------------------------------------------------------------------- documents
  private async upload(user: Profile, requestId: string, form?: FormData) {
    this.role(user, 'owner');
    const request = await this.ownedRequest(user, requestId);
    const snapshotId = String(form?.get('requirement_id') ?? '');
    const found = await getDoc(doc(this.db, 'requests', requestId, 'checklist', snapshotId)).catch(() => null);
    if (!found || !found.exists()) return fail(422, 'Choose an item on this request checklist.');
    const snapshot = found;
    const docs = await this.requestDocs(requestId);
    const last = docs.find((d) => d['requirement_snapshot_id'] === snapshotId);
    if (last?.['review_status'] === 'verified') fail(409, 'This checklist item is already verified. Contact relocation staff if a replacement is needed.');
    if (last?.['review_status'] === 'pending') fail(409, 'This document is already waiting for review.');
    const file = form?.get('file');
    if (!(file instanceof File) || file.size < 1 || file.size > MAX_DOCUMENT_BYTES) {
      fail(422, `Choose a document under ${Math.floor(MAX_DOCUMENT_BYTES / 1024)} KB. Large scans can be compressed or saved as a smaller JPG.`);
    }
    const bytes = new Uint8Array(await (file as File).arrayBuffer());
    const mime = sniffMime(bytes);
    if (!mime || !DOCUMENT_TYPES[mime]) fail(422, 'Allowed document types are PDF, JPG, and PNG.');
    let validUntil = text(form?.get('valid_until'), 10);
    if (validUntil !== '' && !isDate(validUntil)) fail(422, 'Enter a valid document expiration date.');
    const days = snapshot.data()!['validity_days'];
    if (validUntil === '' && days) {
      const d = new Date();
      d.setDate(d.getDate() + Number(days));
      validUntil = stamp(d).slice(0, 10);
    }
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const docRef = doc(collection(this.db, 'requests', requestId, 'documents'));
    const batch = writeBatch(this.db);
    batch.set(docRef, {
      owner_id: user.id,
      owner_name: user.name,
      reference_no: request['reference_no'],
      requirement_snapshot_id: snapshotId,
      requirement_name: snapshot.data()!['name'],
      original_name: (file as File).name.replace(/[^\w. -]/g, '_').slice(0, 200),
      mime_type: mime,
      size_bytes: bytes.length,
      valid_until: validUntil || null,
      review_status: 'pending',
      feedback: null,
      created_at: serverTimestamp(),
    });
    batch.set(doc(this.db, 'requests', requestId, 'files', docRef.id), { owner_id: user.id, mime_type: mime, data: btoa(binary) });
    if (request['status'] === 'corrections_required') {
      batch.update(doc(this.db, 'requests', requestId), { status: 'documents_under_review', updated_at: serverTimestamp() });
      batch.set(doc(collection(this.db, 'requests', requestId, 'history')), {
        old_status: 'corrections_required', new_status: 'documents_under_review', actor_user_id: user.id, actor_name: user.name, notes: 'Corrected document resubmitted', created_at: serverTimestamp(),
      });
    }
    this.notify(batch, user.id, 'Document submitted', 'Your document is waiting for staff review.', 'request', requestId);
    void this.audit('document_uploaded', 'document', docRef.id, 'success', { mime_type: mime, size_bytes: bytes.length }, batch);
    await batch.commit();
    return { id: docRef.id };
  }

  private async listDocuments(user: Profile) {
    const requests = await this.visibleRequests(user);
    const all = (await Promise.all(requests.map((r) => this.requestDocs(r['id'])))).flat();
    return { items: all.sort(byNewest) };
  }

  private split(composite: string): [string, string] {
    const [requestId, docId] = composite.split(':');
    if (!requestId || !docId) fail(404, 'Document not found.');
    return [requestId, docId];
  }

  private async review(user: Profile, composite: string, b: Row) {
    this.role(user, 'staff', 'admin');
    const [requestId, docId] = this.split(composite);
    const decision = String(b['decision'] ?? '');
    const feedback = text(b['feedback'], 2000);
    if (!['verified', 'corrections'].includes(decision) || (decision === 'corrections' && feedback === '')) fail(422, 'Choose a review result and provide correction details when needed.');
    const request = await this.ownedRequest(user, requestId);
    const snap = await getDoc(doc(this.db, 'requests', requestId, 'documents', docId));
    if (!snap.exists()) fail(404, 'Document not found.');
    if (snap.data()!['review_status'] === 'verified') fail(409, 'This document is already verified.');
    const batch = writeBatch(this.db);
    batch.update(doc(this.db, 'requests', requestId, 'documents', docId), {
      review_status: decision, feedback: feedback || null, review_feedback: feedback || null, decision,
      reviewer_id: user.id, reviewer_name: user.name, reviewed_at: serverTimestamp(),
    });
    let newStatus: string | null = null;
    if (decision === 'corrections' && request['status'] === 'documents_under_review') newStatus = 'corrections_required';
    if (decision === 'verified' && request['status'] === 'documents_under_review') {
      const docs = await this.requestDocs(requestId);
      const checklist = (await getDocs(collection(this.db, 'requests', requestId, 'checklist'))).docs;
      const verified = (cid: string) => (cid === snap.data()!['requirement_snapshot_id'] ? true : docs.find((d) => d['requirement_snapshot_id'] === cid)?.['review_status'] === 'verified');
      if (checklist.filter((c) => c.data()['is_required'] === true).every((c) => verified(c.id))) newStatus = 'documents_verified';
    }
    if (newStatus) {
      batch.update(doc(this.db, 'requests', requestId), { status: newStatus, updated_at: serverTimestamp() });
      batch.set(doc(collection(this.db, 'requests', requestId, 'history')), {
        old_status: request['status'], new_status: newStatus, actor_user_id: user.id, actor_name: user.name,
        notes: decision === 'corrections' ? 'Document correction requested' : 'All required documents are verified', created_at: serverTimestamp(),
      });
      this.notify(batch, request['owner_id'], 'Relocation status updated', `Request ${request['reference_no']} is now ${newStatus.replaceAll('_', ' ')}.`, 'request', requestId);
    }
    this.notify(batch, request['owner_id'], 'Document review update', decision === 'verified' ? 'A submitted document has been verified.' : `A document needs corrections: ${feedback}`, 'request', requestId);
    void this.audit('document_' + decision, 'document', docId, 'success', {}, batch);
    await batch.commit();
    return { ok: true, request_status: newStatus ?? request['status'] };
  }

  /** Called by the screens: reads the stored file, saves it through the browser and records the download. */
  async downloadDocument(composite: string): Promise<void> {
    this.init();
    const user = this.need();
    const [requestId, docId] = this.split(composite);
    await this.ownedRequest(user, requestId);
    const [meta, file] = await Promise.all([
      getDoc(doc(this.db, 'requests', requestId, 'documents', docId)),
      getDoc(doc(this.db, 'requests', requestId, 'files', docId)),
    ]);
    if (!meta.exists() || !file.exists()) fail(404, 'Document not found.');
    const raw = atob(file.data()!['data']);
    const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: meta.data()!['mime_type'] }));
    const link = document.createElement('a');
    link.href = url;
    link.download = meta.data()!['original_name'];
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    await this.audit('document_downloaded', 'document', docId);
  }

  // ------------------------------------------------------------------------ requirements
  private async saveRequirement(user: Profile, id: string | null, b: Row) {
    this.role(user, 'admin');
    const name = text(b['name'], 300);
    const type = String(b['relocation_type'] ?? '');
    const days = b['validity_days'] === '' || b['validity_days'] === null || b['validity_days'] === undefined ? null : Number(b['validity_days']);
    const category = String(b['category'] ?? 'other');
    if (!name || name.length > 180 || !['veterinary_health', 'vaccination', 'lgu_permit', 'transport', 'other'].includes(category) || (type !== '' && !['ground', 'air', 'sea', 'other'].includes(type)) || (days !== null && (!Number.isInteger(days) || days < 1 || days > 3650))) {
      fail(422, 'Enter a valid requirement name, category, route type, and validity period.');
    }
    const data = {
      name, description: text(b['description'], 2000), category,
      origin_province: text(b['origin_province'], 120) || null, destination_province: text(b['destination_province'], 120) || null,
      relocation_type: type || null, is_required: !!b['is_required'], instructions: text(b['instructions'], 2000),
      validity_guidance: text(b['validity_guidance'], 500), validity_days: days, authority_reference: text(b['authority_reference'], 500),
      active: !!b['active'], updated_by: user.id,
    };
    const batch = writeBatch(this.db);
    const ref = id ? doc(this.db, 'requirements', id) : doc(collection(this.db, 'requirements'));
    if (id) batch.update(ref, data);
    else batch.set(ref, { ...data, created_at: serverTimestamp() });
    void this.audit(id ? 'requirement_updated' : 'requirement_created', 'route_requirement', ref.id, 'success', {}, batch);
    await batch.commit();
    return id ? { ok: true } : { id: ref.id };
  }

  private async toggleRequirement(user: Profile, id: string, b: Row) {
    this.role(user, 'admin');
    const batch = writeBatch(this.db);
    batch.update(doc(this.db, 'requirements', id), { active: !!b['active'], updated_by: user.id });
    void this.audit(b['active'] ? 'requirement_activated' : 'requirement_deactivated', 'route_requirement', id, 'success', {}, batch);
    await batch.commit();
    return { ok: true };
  }

  // -------------------------------------------------------------------------- schedules
  private async listSchedules(user: Profile): Promise<Row[]> {
    const requests = await this.visibleRequests(user);
    const lists = await Promise.all(
      requests.map(async (r) =>
        (await getDocs(collection(this.db, 'requests', r['id'], 'schedules'))).docs.map((d) => ({
          ...norm(d), id: `${r['id']}:${d.id}`, request_id: r['id'], reference_no: r['reference_no'], pet_name: r['pet_name'], owner_id: r['owner_id'],
        })),
      ),
    );
    return lists.flat();
  }

  private parsePickup(value: string): Date {
    const d = new Date(String(value).replace(' ', 'T'));
    return Number.isNaN(d.getTime()) ? fail(422, 'Enter a valid pickup date and time.') : d;
  }

  private async createSchedule(user: Profile, b: Row) {
    this.role(user, 'staff', 'admin');
    const requestId = String(b['request_id'] ?? '');
    const r = await this.ownedRequest(user, requestId);
    if (!['documents_verified', 'pickup_scheduled'].includes(r['status'])) fail(409, 'Documents must be verified before a pickup can be scheduled.');
    if (!(await this.allRequiredVerified(requestId))) fail(409, 'Required checklist documents must be verified before scheduling.');
    const pickup = this.parsePickup(b['pickup_at']);
    const pl = text(b['pickup_location'], 250), dl = text(b['dropoff_location'], 250);
    if (pickup.getTime() < Date.now() || !pl || !dl) fail(422, 'Enter a valid future pickup date and both pickup and drop-off locations.');
    const data = {
      pickup_at: stamp(pickup), pickup_location: pl, dropoff_location: dl,
      assigned_staff_id: user.role === 'staff' ? user.id : (r['assigned_staff_id'] ?? null),
      status: 'scheduled', instructions: text(b['instructions'], 1000),
    };
    const ref = doc(collection(this.db, 'requests', requestId, 'schedules'));
    const batch = writeBatch(this.db);
    batch.set(ref, { ...data, created_at: serverTimestamp(), history: [{ action: 'created', actor_name: user.name, created_at: stamp(new Date()), old_data: null, new_data: data }] });
    if (r['status'] === 'documents_verified') {
      batch.update(doc(this.db, 'requests', requestId), { status: 'pickup_scheduled', updated_at: serverTimestamp() });
      batch.set(doc(collection(this.db, 'requests', requestId, 'history')), {
        old_status: 'documents_verified', new_status: 'pickup_scheduled', actor_user_id: user.id, actor_name: user.name, notes: 'Pickup schedule created', created_at: serverTimestamp(),
      });
    }
    this.notify(batch, r['owner_id'], 'Pickup schedule arranged', `A pickup schedule has been arranged for ${r['reference_no']}.`, 'request', requestId);
    void this.audit('schedule_created', 'pickup_schedule', ref.id, 'success', {}, batch);
    await batch.commit();
    return { id: `${requestId}:${ref.id}` };
  }

  private async loadSchedule(user: Profile, composite: string) {
    const [requestId, sid] = this.split(composite);
    const request = await this.ownedRequest(user, requestId);
    const snap = await getDoc(doc(this.db, 'requests', requestId, 'schedules', sid));
    if (!snap.exists()) return fail(404, 'Schedule not found.');
    return { request, requestId, sid, row: { ...norm(snap), id: composite, request_id: requestId, reference_no: request['reference_no'], pet_name: request['pet_name'], owner_id: request['owner_id'] } };
  }

  private async scheduleDetail(user: Profile, composite: string) {
    const { row } = await this.loadSchedule(user, composite);
    const history = ((row['history'] as Row[]) ?? []).map((h) => ({ ...h, new_data: h['new_data'] ?? {} }));
    const { history: _ignored, ...schedule } = row;
    return { schedule, history };
  }

  private async updateSchedule(user: Profile, composite: string, b: Row) {
    this.role(user, 'staff', 'admin');
    const { request, requestId, sid, row } = await this.loadSchedule(user, composite);
    const pickup = this.parsePickup(b['pickup_at'] ?? row['pickup_at']);
    const status = String(b['status'] ?? row['status']);
    if (!['scheduled', 'changed', 'completed', 'cancelled'].includes(status)) fail(422, 'Invalid schedule status.');
    if (['scheduled', 'changed'].includes(status) && pickup.getTime() < Date.now()) fail(422, 'Scheduled pickups must be in the future.');
    const pick = (o: Row) => ({ pickup_at: o['pickup_at'], pickup_location: o['pickup_location'], dropoff_location: o['dropoff_location'], instructions: o['instructions'] ?? '', status: o['status'], assigned_staff_id: o['assigned_staff_id'] ?? null });
    const next = { ...pick(row), pickup_at: stamp(pickup), pickup_location: text(b['pickup_location'] ?? row['pickup_location'], 250), dropoff_location: text(b['dropoff_location'] ?? row['dropoff_location'], 250), instructions: text(b['instructions'] ?? row['instructions'], 1000), status };
    const batch = writeBatch(this.db);
    batch.update(doc(this.db, 'requests', requestId, 'schedules', sid), {
      ...next, history: [...((row['history'] as Row[]) ?? []), { action: 'updated', actor_name: user.name, created_at: stamp(new Date()), old_data: pick(row), new_data: next }],
    });
    this.notify(batch, request['owner_id'], 'Pickup schedule changed', `The pickup schedule for ${request['reference_no']} was updated.`, 'request', requestId);
    void this.audit('schedule_updated', 'pickup_schedule', sid, 'success', {}, batch);
    await batch.commit();
    return { ok: true };
  }

  // --------------------------------------------------------------------------- dashboard
  private async dashboard(user: Profile) {
    const requests = await this.visibleRequests(user);
    const docs = (await Promise.all(requests.map((r) => this.requestDocs(r['id'])))).flat();
    const schedules = await this.listSchedules(user);
    const now = stamp(new Date());
    const s: Row = {};
    const upcoming = schedules.filter((x) => String(x['pickup_at']) >= now && ['scheduled', 'changed'].includes(x['status'])).length;
    const count = (list: string[]) => requests.filter((r) => list.includes(r['status'])).length;
    if (user.role === 'owner') {
      const pets = await getDocs(query(collection(this.db, 'pets'), where('owner_id', '==', user.id)));
      const unread = await getDocs(query(collection(this.db, 'notifications'), where('user_id', '==', user.id)));
      const soon = new Date(); soon.setDate(soon.getDate() + 30);
      s['pets'] = pets.size;
      s['requests'] = requests.length;
      s['attention'] = count(['corrections_required', 'documents_pending', 'request_submitted']);
      s['documents_pending'] = docs.filter((d) => d['review_status'] === 'pending').length;
      s['documents_corrections'] = docs.filter((d) => d['review_status'] === 'corrections').length;
      s['upcoming_pickups'] = upcoming;
      s['unread_notifications'] = unread.docs.filter((d) => !d.data()['read_at']).length;
      s['documents_expiring'] = docs.filter((d) => d['valid_until'] && d['valid_until'] >= today() && d['valid_until'] <= stamp(soon).slice(0, 10)).length;
    } else {
      s['requests'] = requests.length;
      s['documents_pending'] = docs.filter((d) => d['review_status'] === 'pending').length;
      s['documents_corrections'] = docs.filter((d) => d['review_status'] === 'corrections').length;
      s['ongoing'] = count(ongoing);
      s['delayed'] = requests.filter((r) => !['completed', 'cancelled'].includes(r['status']) && String(r['requested_date']) < today()).length;
      s['pending_requests'] = count(pending);
      s['completed'] = count(['completed']);
      s['upcoming_pickups'] = upcoming;
      if (user.role === 'admin') {
        const users = (await getDocs(collection(this.db, 'users'))).docs.map((d) => d.data());
        s['active_users'] = users.filter((u) => u['active'] === true).length;
        s['owners'] = users.filter((u) => u['role'] === 'owner' && u['active'] === true).length;
        s['staff'] = users.filter((u) => u['role'] === 'staff' && u['active'] === true).length;
        s['pets'] = (await getDocs(collection(this.db, 'pets'))).size;
      }
    }
    const recent = [...requests].sort((a, c) => String(c['updated_at'] ?? '').localeCompare(String(a['updated_at'] ?? ''))).slice(0, 6);
    return { stats: s, recent };
  }

  // ----------------------------------------------------------------------------- reports
  private async reportRows(q: Record<string, string>): Promise<Row[]> {
    const from = q['from'] ?? '', to = q['to'] ?? '', status = q['status'] ?? '';
    for (const d of [from, to]) if (d && !isDate(d)) fail(422, 'Invalid report date filter.');
    if (status && !isValidStatus(status)) fail(422, 'Invalid status filter.');
    if (from && to && from > to) fail(422, 'The report start date must be before its end date.');
    const origin = text(q['origin'], 120).toLowerCase(), destination = text(q['destination'], 120).toLowerCase();
    const all = (await getDocs(collection(this.db, 'requests'))).docs.map(norm);
    return all
      .filter((r) => (!from || r['requested_date'] >= from) && (!to || r['requested_date'] <= to) && (!status || r['status'] === status))
      .filter((r) => (!origin || String(r['origin_province']).toLowerCase().includes(origin)) && (!destination || String(r['destination_province']).toLowerCase().includes(destination)))
      .sort(byNewest);
  }

  private async reportStats(user: Profile) {
    this.role(user, 'admin');
    const requests = (await getDocs(collection(this.db, 'requests'))).docs.map(norm);
    const docs = (await Promise.all(requests.map((r) => this.requestDocs(r['id'])))).flat();
    const tally = (items: Row[], key: string, label: string) => {
      const map = new Map<string, number>();
      for (const i of items) map.set(i[key], (map.get(i[key]) ?? 0) + 1);
      return [...map].map(([k, total]) => ({ [label]: k, total }));
    };
    const first = new Date(); first.setMonth(first.getMonth() - 11); first.setDate(1);
    const cutoff = stamp(first).slice(0, 7);
    const monthly = tally(requests.filter((r) => String(r['created_at']).slice(0, 7) >= cutoff).map((r) => ({ month: String(r['created_at']).slice(0, 7) })), 'month', 'month').sort((a: Row, c: Row) => a['month'].localeCompare(c['month']));
    return {
      summary: {
        requests: requests.length,
        completed: requests.filter((r) => r['status'] === 'completed').length,
        ongoing: requests.filter((r) => ongoing.includes(r['status'])).length,
        pending: requests.filter((r) => pending.includes(r['status'])).length,
        delayed: requests.filter((r) => !['completed', 'cancelled'].includes(r['status']) && String(r['requested_date']) < today()).length,
        cancelled: requests.filter((r) => r['status'] === 'cancelled').length,
      },
      statuses: tally(requests, 'status', 'status'),
      monthly,
      documents: tally(docs, 'review_status', 'review_status'),
    };
  }

  /** Builds the CSV in the browser and saves it; admins only. */
  async exportReportCsv(filters: Record<string, string>): Promise<void> {
    this.init();
    const user = this.need();
    this.role(user, 'admin');
    const rows = await this.reportRows(filters);
    const lines = [['Reference', 'Pet', 'Owner', 'Origin', 'Destination', 'Requested date', 'Status']].concat(
      rows.map((r) => [r['reference_no'], r['pet_name'], r['owner_name'], `${r['origin_city']}, ${r['origin_province']}`, `${r['destination_city']}, ${r['destination_province']}`, r['requested_date'], r['status']]),
    );
    const blob = new Blob([lines.map((l) => l.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'pettrack-relocation-report.csv';
    link.click();
    URL.revokeObjectURL(url);
    await this.audit('report_exported', 'relocation_report', null, 'success', { filters });
  }
}
