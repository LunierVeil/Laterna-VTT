import { test } from 'node:test';
import { repositorySmoke } from './fixture.mjs';
test('Repository smoke_test.py', {timeout: 30000}, repositorySmoke);
