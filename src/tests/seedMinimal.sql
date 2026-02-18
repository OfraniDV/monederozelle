-- Minimal seed data for tests
INSERT INTO agente (id, nombre) VALUES (1, 'Agente Fake') ON CONFLICT (id) DO NOTHING;
INSERT INTO banco (id, codigo, nombre) VALUES (1, 'FL', 'Fake Bank') ON CONFLICT (id) DO NOTHING;
INSERT INTO moneda (id, codigo, nombre) VALUES (1, 'FL', 'Fake') ON CONFLICT (id) DO NOTHING;

