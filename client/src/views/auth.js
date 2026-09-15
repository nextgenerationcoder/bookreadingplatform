import { api } from '../api.js';

export function renderAuth(host, onAuthenticated) {
  let mode = 'login'; // 'login' | 'signup'

  function render() {
    host.innerHTML = `
      <div class="authPage">
        <div class="authCard">
          <h1>Bilingual Reader</h1>
          <p class="hint">${mode === 'login' ? 'Log in to see your words and progress.' : 'Create an account to start saving your words and progress.'}</p>
          <form id="authForm">
            <label>Email
              <input type="email" id="email" required autocomplete="email">
            </label>
            <label>Password
              <input type="password" id="password" required minlength="6" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}">
            </label>
            <button type="submit" id="submitBtn">${mode === 'login' ? 'Log In' : 'Sign Up'}</button>
          </form>
          <div id="authStatus" class="importStatus"></div>
          <p class="authSwitch">
            ${mode === 'login' ? "Don't have an account?" : 'Already have an account?'}
            <a href="#" id="switchMode">${mode === 'login' ? 'Sign up' : 'Log in'}</a>
          </p>
        </div>
      </div>
    `;

    host.querySelector('#switchMode').onclick = (e) => {
      e.preventDefault();
      mode = mode === 'login' ? 'signup' : 'login';
      render();
    };

    const form = host.querySelector('#authForm');
    const status = host.querySelector('#authStatus');
    const submitBtn = host.querySelector('#submitBtn');

    form.onsubmit = async (e) => {
      e.preventDefault();
      const email = host.querySelector('#email').value.trim();
      const password = host.querySelector('#password').value;
      submitBtn.disabled = true;
      status.textContent = '';
      status.className = 'importStatus';
      try {
        const user = mode === 'login' ? await api.login(email, password) : await api.signup(email, password);
        onAuthenticated(user);
      } catch (err) {
        status.textContent = err.message;
        status.className = 'importStatus error';
      } finally {
        submitBtn.disabled = false;
      }
    };
  }

  render();
}
