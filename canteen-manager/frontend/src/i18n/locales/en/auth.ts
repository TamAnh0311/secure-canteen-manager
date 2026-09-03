const auth = {
  signIn: 'Sign in',
  username: 'Username',
  password: 'Password',
  backOfficeSignIn: 'Back-office sign-in · Local accounts only',
  airGappedNotice: 'Air-gapped LAN. No internet. Credentials stored locally.',
  errorInvalidCredentials: 'Invalid username or password.',
  errorUnableToSignIn: 'Unable to sign in. Please try again.',
} as const;

export default auth;
