const { execSync } = require('child_process');

it('all test files reside in tests/ directory', () => {
  const output = execSync('find . -name "*.test.js" -not -path "./node_modules/*"').toString().trim().split('\n').filter(Boolean);
  const outside = output.filter((p) => !p.startsWith('./tests/'));
  expect(outside).toEqual([]);
});
