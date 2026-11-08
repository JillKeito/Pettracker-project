import { isFirebaseConfigured } from '../environments/firebase.config';
import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
    })
      .compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should offer sign-in and owner-only sign-up', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Every journey');
    expect(compiled.querySelector('input[autocomplete="username"]')).toBeTruthy();
    expect(compiled.textContent).toContain('Create an account');
  });

   it('should show the setup banner only while the Firebase settings are placeholders', async () => {
     const fixture = TestBed.createComponent(App);
     await fixture.whenStable();
     fixture.detectChanges();
     const compiled = fixture.nativeElement as HTMLElement;
     const bannerShown = (compiled.textContent ?? '').includes('Firebase is not set up yet');
     expect(bannerShown).toBe(!isFirebaseConfigured);
   });

  it('should show the sign-up form without any role selector', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.componentInstance.setAuthMode('signup');
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('input[name="signupEmail"]')).toBeTruthy();
    expect(compiled.querySelector('input[name="signupConfirm"]')).toBeTruthy();
    expect(compiled.querySelector('select')).toBeNull();
  });

  it('should reject mismatched passwords before calling the server', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.signup = { name: 'Ana', email: 'ana@example.test', password: 'abc', password_confirm: 'xyz', website: '' };
    await app.signUp();
    expect(app.error).toContain('do not match');
    expect(app.user).toBeNull();
  });
});
