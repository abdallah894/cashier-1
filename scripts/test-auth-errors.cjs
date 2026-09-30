const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { test } = require('node:test');

const source = ts.transpileModule(readFileSync('lib/actions/auth.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

async function signInWithError(error) {
  const exports = {};
  vm.runInNewContext(source, {
    exports,
    require(name) {
      if (name === 'zod') return require('zod');
      if (name === '@/lib/supabase/server') {
        return { createClient: async () => ({
          auth: { signInWithPassword: async () => ({ data: {}, error }) },
        }) };
      }
      return {};
    },
  });
  const form = new FormData();
  form.set('email', 'test@example.com');
  form.set('password', 'test-password');
  return (await exports.signIn({}, form)).error;
}

test('connection failures do not claim the password is wrong', async () => {
  assert.equal(await signInWithError({ name: 'AuthRetryableFetchError', status: 0 }), 'signInUnavailable');
});

test('invalid credentials retain the credentials message', async () => {
  assert.equal(await signInWithError({ code: 'invalid_credentials', status: 400 }), 'invalidCredentials');
});

test('service errors do not claim the password is wrong', async () => {
  assert.equal(await signInWithError({ status: 503 }), 'signInUnavailable');
});
