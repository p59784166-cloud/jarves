import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeSystemPrompt, getProfilePrompt, listProfiles } from '../../ai/core/profiles.mjs';

test('perfis de IA são listados sem expor configurações sensíveis', () => {
  const profiles = listProfiles();
  assert.ok(profiles.some(profile => profile.id === 'programmer'));
  assert.ok(profiles.some(profile => profile.id === 'reviewer'));
  assert.ok(profiles.every(profile => !Object.hasOwn(profile, 'prompt')));
});

test('perfil programador inclui validação e não permite alegar execução inexistente', () => {
  const prompt = getProfilePrompt('programmer');
  assert.match(prompt, /testes/i);
  assert.match(prompt, /sem evidência/i);
});

test('prompt personalizado é limitado e combinado com o perfil', () => {
  const prompt = composeSystemPrompt('planner', 'Use tópicos curtos');
  assert.match(prompt, /planejador técnico/i);
  assert.match(prompt, /Use tópicos curtos/);
  assert.throws(() => composeSystemPrompt('unknown'), /Perfil de IA desconhecido/);
});
