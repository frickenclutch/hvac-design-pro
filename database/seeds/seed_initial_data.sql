-- Seed Script for HVAC Pro Demo Environment

-- We must temporarily bypass RLS to insert base data from an admin context
SET app.current_org_id = '00000000-0000-0000-0000-000000000000';

-- 1. Create Demo Organisations
INSERT INTO organisations (id, slug, name, plan, seats_limit)
VALUES 
    ('11111111-1111-1111-1111-111111111111', 'acme-hvac', 'Acme HVAC Pros', 'professional', 10),
    ('22222222-2222-2222-2222-222222222222', 'wright-bros', 'Wright Brothers HVAC', 'starter', 3);

-- 2. Create Demo Users
INSERT INTO users (id, org_id, email, cognito_sub, role, first_name, last_name)
VALUES
    ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'alice@acmehvac.com', 'cognito123', 'admin', 'Alice', 'Engineer'),
    ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'bob@acmehvac.com', 'cognito456', 'tech', 'Bob', 'Technician'),
    ('55555555-5555-5555-5555-555555555555', '22222222-2222-2222-2222-222222222222', 'charlie@wrightbros.com', 'cognito789', 'admin', 'Charlie', 'Wright');

-- 3. Create Demo Projects
INSERT INTO projects (id, org_id, name, address, city, state, zip, created_by)
VALUES
    ('66666666-6666-6666-6666-666666666666', '11111111-1111-1111-1111-111111111111', 'The Walker Residence', '123 Fake Street', 'Springfield', 'IL', '62701', '33333333-3333-3333-3333-333333333333'),
    ('77777777-7777-7777-7777-777777777777', '22222222-2222-2222-2222-222222222222', 'Smith Commercial Replacement', '456 Tech Blvd', 'Austin', 'TX', '73301', '55555555-5555-5555-5555-555555555555');

-- 4. Create Demo Rooms for The Walker Residence (Org 1)
INSERT INTO rooms (id, project_id, org_id, name, floor_area_sqft, ceiling_height)
VALUES
    ('88888888-8888-8888-8888-888888888881', '66666666-6666-6666-6666-666666666666', '11111111-1111-1111-1111-111111111111', 'Living Room', 400.0, 9.0),
    ('88888888-8888-8888-8888-888888888882', '66666666-6666-6666-6666-666666666666', '11111111-1111-1111-1111-111111111111', 'Master Bedroom', 300.0, 8.0);

-- Reset context
RESET app.current_org_id;
