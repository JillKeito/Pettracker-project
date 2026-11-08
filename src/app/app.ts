import { AfterViewChecked, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PetTrackApi } from './api';

type User = {
  id: string;
  name: string;
  email: string;
  role: string;
  must_change_password?: boolean;
};
type Row = any;

@Component({
  imports: [FormsModule],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App implements OnInit, AfterViewChecked {
  constructor(private readonly changeDetector: ChangeDetectorRef) {}

  private readonly api = new PetTrackApi();
  firebaseReady = this.api.configured;

  user: User | null = null;
  csrf = '';
  view = 'overview';
  publicPage = '';
  loading = false;
  private errorValue = '';
  private noticeValue = '';
  get error() {
    return this.errorValue;
  }
  set error(value: string) {
    this.errorValue = value;
    this.changeDetector.markForCheck();
  }
  get notice() {
    return this.noticeValue;
  }
  set notice(value: string) {
    this.noticeValue = value;
    this.changeDetector.markForCheck();
  }
  data: Row[] = [];
  pets: Row[] = [];
  staffList: Row[] = [];
  requestChoices: Row[] = [];
  stats: any = {};
  reportStats: any = null;
  systemInfo: any = null;
  reportRows: Row[] = [];
  reportFilters: Row = { from: '', to: '', status: '', origin: '', destination: '' };
  private chartStatus: any = null;
  private chartMonthly: any = null;
  private chartKey = '';
  private requestDetailsValue: Row | null = null;
  private petDetailValue: Row | null = null;
  private scheduleDetailsValue: Row | null = null;
  get requestDetails() {
    return this.requestDetailsValue;
  }
  set requestDetails(value: Row | null) {
    this.requestDetailsValue = value;
    this.changeDetector.markForCheck();
  }
  get petDetail() {
    return this.petDetailValue;
  }
  set petDetail(value: Row | null) {
    this.petDetailValue = value;
    this.changeDetector.markForCheck();
  }
  get scheduleDetails() {
    return this.scheduleDetailsValue;
  }
  set scheduleDetails(value: Row | null) {
    this.scheduleDetailsValue = value;
    this.changeDetector.markForCheck();
  }
  editingPetId: string | null = null;
  vaccinationForm: Row = { vaccine_name: '', administered_on: '', expires_on: '', notes: '' };
  login = { email: '', password: '' };
  authMode: 'signin' | 'signup' = 'signin';
  signupEnabled = true;
  signup = { name: '', email: '', password: '', password_confirm: '', website: '' };
  petForm: Row = {
    name: '',
    species: 'Dog',
    breed: '',
    sex: '',
    birth_date: '',
    color: '',
    weight_kg: '',
    health_notes: '',
  };
  requestForm: Row = {
    pet_id: '',
    origin_city: '',
    origin_province: '',
    destination_city: '',
    destination_province: '',
    relocation_type: 'ground',
    pickup_address: '',
    dropoff_address: '',
    emergency_contact_name: '',
    emergency_contact_phone: '',
    requested_date: '',
    preferred_time: '',
    notes: '',
  };
  accountForm: Row = { name: '', email: '', password: '', role: 'owner' };
  passwordForm: Row = { current_password: '', new_password: '' };
  profileForm: Row = { name: '', email: '' };
  requirementForm: Row = {
    name: '',
    description: '',
    category: 'veterinary_health',
    origin_province: '',
    destination_province: '',
    relocation_type: '',
    instructions: '',
    validity_guidance: '',
    validity_days: '',
    authority_reference: '',
    is_required: false,
    active: true,
  };
  editingRequirementId: string | null = null;
  scheduleForm: Row = {
    request_id: '',
    pickup_at: '',
    pickup_location: '',
    dropoff_location: '',
    instructions: '',
  };
  search = '';

  async ngOnInit() {
    await this.restoreSession();
  }
  ngAfterViewChecked() {
    const Chart = (window as any).Chart;
    if (this.view !== 'reports' || !this.reportStats || !Chart) return;
    const key = JSON.stringify(this.reportStats);
    if (key === this.chartKey) return;
    this.chartKey = key;
    this.chartStatus?.destroy();
    this.chartMonthly?.destroy();
    const statusCanvas = document.getElementById('statusChart') as HTMLCanvasElement | null;
    const monthCanvas = document.getElementById('monthlyChart') as HTMLCanvasElement | null;
    if (statusCanvas)
      this.chartStatus = new Chart(statusCanvas, {
        type: 'doughnut',
        data: {
          labels: this.reportStats.statuses.map((x: any) => this.label(x.status)),
          datasets: [
            {
              data: this.reportStats.statuses.map((x: any) => Number(x.total)),
              backgroundColor: [
                '#70ad91',
                '#6e91bc',
                '#edb377',
                '#a58ac9',
                '#7ebbc0',
                '#df8971',
                '#9eaaa3',
                '#b5c98d',
              ],
            },
          ],
        },
        options: { responsive: true, plugins: { legend: { position: 'bottom' } } },
      });
    if (monthCanvas)
      this.chartMonthly = new Chart(monthCanvas, {
        type: 'bar',
        data: {
          labels: this.reportStats.monthly.map((x: any) => x.month),
          datasets: [
            {
              label: 'Requests',
              data: this.reportStats.monthly.map((x: any) => Number(x.total)),
              backgroundColor: '#5c9d83',
              borderRadius: 5,
            },
          ],
        },
        options: {
          responsive: true,
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
        },
      });
  }
  showPublic(page: string) {
    this.publicPage = page;
    this.error = '';
  }
  get role() {
    return this.user?.role ?? '';
  }
  get title() {
    return (
      (
        {
          overview: 'Overview',
          pets: 'My pets',
          requests: 'Relocation requests',
          documents: 'Document review',
          schedule: 'Pickup schedule',
          notifications: 'Notifications',
          users: 'User management',
          requirements: 'Route requirements',
          reports: 'Reports & activity',
          system: 'System health & operations',
          profile: 'Account profile',
        } as Record<string, string>
      )[this.view] ?? 'Overview'
    );
  }
  get nav() {
    if (this.role === 'admin')
      return [
        ['overview', 'Overview', 'grid'],
        ['users', 'User management', 'people'],
        ['requests', 'Relocation requests', 'truck'],
        ['requirements', 'Route requirements', 'checklist'],
        ['documents', 'Document review', 'file'],
        ['schedule', 'Schedules', 'calendar'],
        ['notifications', 'Notifications', 'bell'],
        ['reports', 'Reports & audit', 'chart'],
        ['system', 'System health', 'settings'],
      ];
    if (this.role === 'staff')
      return [
        ['overview', 'Overview', 'grid'],
        ['requests', 'Authorized requests', 'truck'],
        ['documents', 'Document review', 'file'],
        ['schedule', 'Pickup schedule', 'calendar'],
        ['notifications', 'Notifications', 'bell'],
      ];
    return [
      ['overview', 'Overview', 'grid'],
      ['pets', 'My pets', 'paw'],
      ['requests', 'My relocations', 'truck'],
      ['schedule', 'Pickup schedule', 'calendar'],
      ['notifications', 'Notifications', 'bell'],
      ['profile', 'Account profile', 'person'],
    ];
  }
  async restoreSession() {
    try {
      const result = await this.call('/me');
      this.user = result.user;
      this.csrf = result.csrf;
      this.signupEnabled = result.signup_enabled !== false;
      if (this.user) {
        this.profileForm = { name: this.user.name, email: this.user.email };
        await this.loadView();
      }
    } catch {
      /* API is configured when the PHP service is started. */
    } finally {
      this.changeDetector.detectChanges();
    }
  }
  /** Same call shape as before, now answered by Firebase (see api.ts). */
  async call(
    path: string,
    method = 'GET',
    body?: any,
    form?: FormData,
    query: Record<string, string> = {},
  ): Promise<any> {
    return this.api.call(path, method, body, form, query);
  }
  async signIn() {
    this.error = '';
    this.loading = true;
    try {
      const result = await this.call('/login', 'POST', this.login);
      const signedIn = result.user as User;
      this.user = signedIn;
      this.csrf = result.csrf;
      this.profileForm = { name: signedIn.name, email: signedIn.email };
      this.notice = 'Welcome to PetTrack.';
      await this.loadView();
    } catch (e: any) {
      this.error = e.message;
    } finally {
      this.loading = false;
      this.changeDetector.detectChanges();
    }
  }
  setAuthMode(mode: 'signin' | 'signup') {
    this.authMode = mode;
    this.error = '';
  }
  async signUp() {
    this.error = '';
    if (this.signup.password !== this.signup.password_confirm) {
      this.error = 'The two passwords do not match.';
      return;
    }
    this.loading = true;
    try {
      const result = await this.call('/register', 'POST', this.signup);
      const created = result.user as User;
      this.user = created;
      this.csrf = result.csrf;
      this.profileForm = { name: created.name, email: created.email };
      this.signup = { name: '', email: '', password: '', password_confirm: '', website: '' };
      this.authMode = 'signin';
      this.notice = 'Your account was created. Welcome to PetTrack.';
      await this.loadView();
    } catch (e: any) {
      this.error = e.message;
    } finally {
      this.loading = false;
      this.changeDetector.detectChanges();
    }
  }
  async signOut() {
    try {
      await this.call('/logout', 'POST', {});
    } catch {}
    this.user = null;
    this.csrf = '';
    this.data = [];
    this.view = 'overview';
    this.changeDetector.detectChanges();
  }
  async navigate(view: string) {
    if (this.view === 'reports' && view !== 'reports') {
      this.chartStatus?.destroy();
      this.chartMonthly?.destroy();
      this.chartStatus = null;
      this.chartMonthly = null;
      this.chartKey = '';
    }
    this.view = view;
    this.error = '';
    this.notice = '';
    await this.loadView();
  }
  async loadView() {
    if (!this.user) return;
    this.loading = true;
    this.error = '';
    try {
      if (this.view === 'overview') {
        const res = await this.call('/dashboard');
        this.stats = res.stats;
        this.data = res.recent ?? [];
      } else if (this.view === 'pets') {
        const res = await this.call('/pets');
        this.data = res.items ?? [];
      } else if (this.view === 'requests') {
        const res = await this.call('/requests');
        this.data = res.items ?? [];
        this.pets = this.role === 'owner' ? ((await this.call('/pets')).items ?? []) : [];
        this.staffList =
          this.role === 'admin'
            ? ((
                await this.call('/users', 'GET', undefined, undefined, {
                  role: 'staff',
                  active: '1',
                  limit: '100',
                })
              ).items ?? [])
            : [];
      } else if (this.view === 'users')
        this.data =
          (await this.call('/users', 'GET', undefined, undefined, { limit: '100' })).items ?? [];
      else if (this.view === 'requirements')
        this.data = (await this.call('/requirements')).items ?? [];
      else if (this.view === 'documents') this.data = (await this.call('/documents')).items ?? [];
      else if (this.view === 'schedule') {
        this.data = (await this.call('/schedules')).items ?? [];
        this.requestChoices =
          this.role === 'owner' ? [] : ((await this.call('/requests')).items ?? []);
      } else if (this.view === 'notifications')
        this.data = (await this.call('/notifications')).items ?? [];
      else if (this.view === 'system') this.systemInfo = await this.call('/admin/health');
      else if (this.view === 'reports') {
        const query = Object.fromEntries(
          Object.entries(this.reportFilters)
            .filter(([, v]) => !!v)
            .map(([k, v]) => [k, String(v)]),
        );
        const [audit, stats, requests] = await Promise.all([
          this.call('/audit'),
          this.call('/reports/stats'),
          this.call('/reports/requests', 'GET', undefined, undefined, query),
        ]);
        this.data = audit.items ?? [];
        this.reportRows = requests.items ?? [];
        this.reportStats = stats;
        this.chartKey = '';
      }
    } catch (e: any) {
      this.error = e.message;
    } finally {
      this.loading = false;
      this.changeDetector.detectChanges();
    }
  }
  async addPet() {
    this.loading = true;
    this.error = '';
    try {
      await this.call(
        this.editingPetId ? `/pets/${this.editingPetId}` : '/pets',
        this.editingPetId ? 'PUT' : 'POST',
        this.petForm,
      );
      this.editingPetId = null;
      this.petForm = {
        name: '',
        species: 'Dog',
        breed: '',
        sex: '',
        birth_date: '',
        color: '',
        weight_kg: '',
        health_notes: '',
      };
      this.notice = 'Pet profile saved.';
      await this.loadView();
    } catch (e: any) {
      this.error = e.message;
    } finally {
      this.loading = false;
      this.changeDetector.detectChanges();
    }
  }
  editPet(pet: Row) {
    this.editingPetId = pet.id;
    this.petForm = { ...pet };
  }
  async openPet(pet: Row) {
    try {
      this.petDetail = await this.call(`/pets/${pet.id}`);
    } catch (e: any) {
      this.error = e.message;
    } finally {
      this.changeDetector.detectChanges();
    }
  }
  async uploadPetPhoto(pet: Row, event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    try {
      await this.call(`/pets/${pet.id}/photo`, 'POST', undefined, form);
      this.notice = 'Pet photo uploaded.';
      await this.loadView();
    } catch (e: any) {
      this.error = e.message;
      this.changeDetector.detectChanges();
    }
  }
  async addVaccination() {
    if (!this.petDetail) return;
    try {
      await this.call(`/pets/${this.petDetail.pet.id}/vaccinations`, 'POST', this.vaccinationForm);
      this.vaccinationForm = { vaccine_name: '', administered_on: '', expires_on: '', notes: '' };
      await this.openPet({ id: this.petDetail.pet.id });
    } catch (e: any) {
      this.error = e.message;
      this.changeDetector.detectChanges();
    }
  }
  async createRequest() {
    this.loading = true;
    this.error = '';
    try {
      await this.call('/requests', 'POST', this.requestForm);
      this.notice = 'Relocation request submitted. Its route checklist is ready.';
      this.requestForm = {
        pet_id: '',
        origin_city: '',
        origin_province: '',
        destination_city: '',
        destination_province: '',
        relocation_type: 'ground',
        pickup_address: '',
        dropoff_address: '',
        emergency_contact_name: '',
        emergency_contact_phone: '',
        requested_date: '',
        preferred_time: '',
        notes: '',
      };
      await this.loadView();
    } catch (e: any) {
      this.error = e.message;
    } finally {
      this.loading = false;
      this.changeDetector.detectChanges();
    }
  }
  async createAccount() {
    this.loading = true;
    this.error = '';
    try {
      await this.call('/users', 'POST', this.accountForm);
      this.notice = 'Account created. Share the temporary password securely.';
      this.accountForm = { name: '', email: '', password: '', role: 'owner' };
      await this.loadView();
    } catch (e: any) {
      this.error = e.message;
    } finally {
      this.loading = false;
      this.changeDetector.detectChanges();
    }
  }
  async toggleAccount(row: Row) {
    try {
      await this.call(`/users/${row.id}/${row.active ? 'deactivate' : 'activate'}`, 'POST', {});
      this.notice = `Account ${row.active ? 'deactivated' : 'activated'}.`;
      await this.loadView();
    } catch (e: any) {
      this.error = e.message;
    }
  }
  async editAccount(row: Row) {
    const name = window.prompt('Account name:', row.name);
    if (name === null) return;
    const email = window.prompt('Email address:', row.email);
    if (email === null) return;
    const role = window.prompt('Role: admin, staff, or owner', row.role);
    if (role === null) return;
    try {
      await this.call(`/users/${row.id}`, 'PUT', { name, email, role });
      this.notice = 'Account details updated.';
      await this.loadView();
    } catch (e: any) {
      this.error = e.message;
    }
  }
  async resetUserPassword(row: Row) {
    if (!window.confirm(`Send a password reset email to ${row.email}?`)) return;
    try {
      await this.call(`/users/${row.id}/reset-password`, 'POST', {});
      this.notice = 'Password reset email sent. The user sets a new password from the email link.';
    } catch (e: any) {
      this.error = e.message;
    }
  }
  async saveRequirement() {
    try {
      await this.call(
        this.editingRequirementId ? `/requirements/${this.editingRequirementId}` : '/requirements',
        this.editingRequirementId ? 'PUT' : 'POST',
        this.requirementForm,
      );
      this.notice = this.editingRequirementId
        ? 'Route requirement updated.'
        : 'Route requirement saved.';
      this.editingRequirementId = null;
      this.requirementForm = {
        name: '',
        description: '',
        category: 'other',
        origin_province: '',
        destination_province: '',
        relocation_type: '',
        instructions: '',
        validity_guidance: '',
        validity_days: '',
        authority_reference: '',
        is_required: false,
        active: true,
      };
      await this.loadView();
    } catch (e: any) {
      this.error = e.message;
    }
  }
  async editRequirement(row: Row) {
    this.editingRequirementId = String(row.id);
    this.requirementForm = { ...row, validity_days: row.validity_days ?? '' };
  }
  cancelRequirementEdit() {
    this.editingRequirementId = null;
    this.requirementForm = {
      name: '',
      description: '',
      category: 'other',
      origin_province: '',
      destination_province: '',
      relocation_type: '',
      instructions: '',
      validity_guidance: '',
      validity_days: '',
      authority_reference: '',
      is_required: false,
      active: true,
    };
  }
  async toggleRequirement(row: Row) {
    try {
      await this.call(`/requirements/${row.id}/status`, 'POST', { active: !row.active });
      this.notice = 'Requirement status updated.';
      await this.loadView();
    } catch (e: any) {
      this.error = e.message;
    }
  }
  async createSchedule() {
    try {
      await this.call('/schedules', 'POST', this.scheduleForm);
      this.notice = 'Pickup schedule created and owner notified.';
      this.scheduleForm = {
        request_id: '',
        pickup_at: '',
        pickup_location: '',
        dropoff_location: '',
        instructions: '',
      };
      await this.loadView();
    } catch (e: any) {
      this.error = e.message;
    }
  }
  async updateSchedule(row: Row) {
    const status = window.prompt(
      'Schedule status: scheduled, changed, completed, or cancelled',
      row.status,
    );
    if (status === null) return;
    const pickup_at = window.prompt(
      'Pickup date and time (YYYY-MM-DD HH:MM):',
      String(row.pickup_at).replace('T', ' ').slice(0, 16),
    );
    if (pickup_at === null) return;
    const pickup_location = window.prompt('Pickup location:', row.pickup_location);
    if (pickup_location === null) return;
    const dropoff_location = window.prompt('Drop-off location:', row.dropoff_location);
    if (dropoff_location === null) return;
    try {
      await this.call(`/schedules/${row.id}`, 'PUT', {
        status,
        pickup_at,
        pickup_location,
        dropoff_location,
      });
      this.notice = 'Schedule updated and owner notified.';
      await this.loadView();
    } catch (e: any) {
      this.error = e.message;
    }
  }
  async openSchedule(row: Row) {
    try {
      this.scheduleDetails = await this.call(`/schedules/${row.id}`);
    } catch (e: any) {
      this.error = e.message;
    }
  }
  async changePassword() {
    this.error = '';
    this.loading = true;
    try {
      const result = await this.call('/password', 'POST', this.passwordForm);
      this.user = result.user;
      if (result.csrf) this.csrf = result.csrf; // the server rotates the CSRF token with the session ID
      this.passwordForm = { current_password: '', new_password: '' };
      this.notice = 'Password updated.';
      await this.loadView();
    } catch (e: any) {
      this.error = e.message;
    } finally {
      this.loading = false;
    }
  }
  async saveProfile() {
    try {
      const result = await this.call('/profile', 'PUT', this.profileForm);
      const updated = result.user as User;
      this.user = updated;
      this.profileForm = { name: updated.name, email: updated.email };
      this.notice = 'Profile updated.';
    } catch (e: any) {
      this.error = e.message;
    }
  }
  async updateStatus(row: Row, status: string) {
    const notes = window.prompt('Add an operational note (optional):') ?? '';
    try {
      await this.call(`/requests/${row.id}/status`, 'POST', { status, notes });
      this.notice = `Request ${row.reference_no} updated.`;
      await this.loadView();
    } catch (e: any) {
      this.error = e.message;
    }
  }
  async assignStaff(row: Row, staffId: string) {
    try {
      await this.call(`/requests/${row.id}/assignment`, 'POST', { staff_id: staffId || null });
      this.notice = 'Request assignment updated.';
      await this.loadView();
    } catch (e: any) {
      this.error = e.message;
    }
  }
  async cancelRequest(row: Row) {
    if (!window.confirm(`Cancel relocation request ${row.reference_no}?`)) return;
    try {
      await this.call(`/requests/${row.id}/cancel`, 'POST', {});
      this.notice = 'Request cancelled.';
      await this.loadView();
    } catch (e: any) {
      this.error = e.message;
    }
  }
  async reviewDocument(row: Row, decision: string) {
    const feedback =
      decision === 'corrections' ? window.prompt('Tell the owner what to correct:') : '';
    if (decision === 'corrections' && !feedback) return;
    try {
      await this.call(`/documents/${row.id}/review`, 'POST', { decision, feedback });
      this.notice = 'Document review saved.';
      await this.loadView();
    } catch (e: any) {
      this.error = e.message;
    }
  }
  async markRead(row: Row) {
    try {
      await this.call(`/notifications/${row.id}/read`, 'POST', {});
      await this.loadView();
    } catch (e: any) {
      this.error = e.message;
    }
  }
  async exportReport() {
    try {
      const filters = Object.fromEntries(
        Object.entries(this.reportFilters)
          .filter(([, v]) => !!v)
          .map(([k, v]) => [k, String(v)]),
      );
      await this.api.exportReportCsv(filters);
    } catch (e: any) {
      this.error = e.message;
    }
  }
  async downloadDocument(row: Row, event: Event) {
    event.preventDefault();
    try {
      await this.api.downloadDocument(String(row.id));
    } catch (e: any) {
      this.error = e.message;
      this.changeDetector.detectChanges();
    }
  }
  printSummary() {
    window.print();
  }
  async openNotification(row: Row) {
    if (row.record_type !== 'request' || !row.record_id) return;
    await this.navigate('requests');
    await this.openRequest({ id: row.record_id });
  }
  async openRequest(row: Row) {
    this.error = '';
    try {
      this.requestDetails = await this.call(`/requests/${row.id}`);
    } catch (e: any) {
      this.error = e.message;
    }
  }
  async uploadDocument(row: Row, event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    form.append('requirement_id', String(row.id));
    if (row.upload_valid_until) form.append('valid_until', String(row.upload_valid_until));
    try {
      await this.call(`/requests/${row.request_id}/documents`, 'POST', undefined, form);
      this.notice = 'Document submitted for staff review.';
      await this.openRequest({ id: row.request_id });
    } catch (e: any) {
      this.error = e.message;
    }
  }
  filtered(items: Row[]) {
    const needle = this.search.trim().toLowerCase();
    return needle ? items.filter((x) => JSON.stringify(x).toLowerCase().includes(needle)) : items;
  }
  label(value: string) {
    return (value || '').replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
  encode(value: string) {
    return encodeURIComponent(value);
  }
  transitions(status: string): string[] {
    return (
      (
        {
          request_submitted: ['request_confirmed', 'cancelled'],
          request_confirmed: ['documents_pending', 'documents_under_review', 'cancelled'],
          documents_pending: ['documents_under_review', 'cancelled'],
          documents_under_review: ['corrections_required', 'documents_verified'],
          corrections_required: ['documents_under_review', 'cancelled'],
          documents_verified: ['pickup_scheduled'],
          pickup_scheduled: ['picked_up'],
          picked_up: ['in_transit'],
          in_transit: ['arrived'],
          arrived: ['released'],
          released: ['completed'],
        } as Record<string, string[]>
      )[status] ?? []
    );
  }
}
