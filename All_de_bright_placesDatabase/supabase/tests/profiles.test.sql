-- Exercises fixed profile ownership, pending-upload serialization, and private object reads.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public,extensions;
select plan(25);
insert into auth.users(id,email) values
 ('11111111-1111-4111-8111-111111111111','profile-ruby@example.invalid'),
 ('22222222-2222-4222-8222-222222222222','profile-jayatci@example.invalid');
insert into public.editor_accounts values
 ('11111111-1111-4111-8111-111111111111','ruby'),
 ('22222222-2222-4222-8222-222222222222','jayatci');
select is((select count(*)::int from public.editor_profiles),2,'two fixed profiles are seeded');

set local role anon;
select set_config('request.jwt.claims','{}',true);
select is((select count(*)::int from editor_profiles),2,'visitors can read public profile rows');
select throws_ok($$select update_editor_profile('ruby','Changed','public')$$,'42501',null,'visitors cannot edit profiles');
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","aal":"aal1"}',true);
select throws_ok($$select update_editor_profile('ruby','Changed','public')$$,'42501','FORBIDDEN','password-only editor cannot edit profile');
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","aal":"aal2"}',true);
select throws_ok($$select update_editor_profile('jayatci','Changed','public')$$,'42501','FORBIDDEN','Ruby cannot edit Jayatci profile');
select throws_ok($$update editor_profiles set bio='Direct' where username='ruby'$$,'42501',null,'direct table writes are denied');
select lives_ok($$select update_editor_profile('ruby','Hello','friends')$$,'owner can edit bio and visibility');
select is((select bio from editor_profiles where username='ruby'),'Hello','public bio persists');
select lives_ok($$select reserve_profile_picture('ruby','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$$,'owner reserves one picture path');
select throws_ok($$select reserve_profile_picture('ruby','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')$$,'P0001','PROFILE_BUSY','concurrent upload reservation is rejected');
select throws_ok($$select remove_profile_picture('ruby')$$,'P0001','PROFILE_BUSY','remove cannot race an active upload');
select set_config('storage.operation','object.create',true);
select lives_ok($$insert into storage.objects(bucket_id,name) values('profile-pictures','ruby/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp')$$,'reserved object may be uploaded');
select lives_ok($$select finalize_profile_picture('ruby','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$$,'reserved picture becomes current');
select set_config('storage.operation','object.delete',true);
select is((select count(*)::int from storage.objects where bucket_id='profile-pictures'),0,'active picture cannot be deleted directly');
select set_config('storage.operation','object.sign',true);
select is((select count(*)::int from storage.objects where bucket_id='profile-pictures'),0,'signed picture URLs are denied');
select set_config('storage.operation','object.get_authenticated',true);
select is((select count(*)::int from storage.objects where bucket_id='profile-pictures'),1,'MFA editor can see Friends picture');
select set_config('storage.operation','object.get_authenticated_info',true);
select is((select count(*)::int from storage.objects where bucket_id='profile-pictures'),1,'MFA editor can read Friends picture metadata');
reset role;

set local role anon;
select set_config('request.jwt.claims','{}',true);
select set_config('storage.operation','object.get_authenticated',true);
select is((select count(*)::int from storage.objects where bucket_id='profile-pictures'),0,'visitor cannot see Friends picture');
select set_config('storage.operation','object.get_authenticated_info',true);
select is((select count(*)::int from storage.objects where bucket_id='profile-pictures'),0,'visitor cannot read Friends picture metadata');
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","aal":"aal2"}',true);
select lives_ok($$select update_editor_profile('ruby','Hello','public')$$,'owner can publish current picture');
reset role;

set local role anon;
select set_config('request.jwt.claims','{}',true);
select set_config('storage.operation','object.get_authenticated',true);
select is((select count(*)::int from storage.objects where bucket_id='profile-pictures'),1,'visitor can see public picture');
select set_config('storage.operation','object.get_authenticated_info',true);
select is((select count(*)::int from storage.objects where bucket_id='profile-pictures'),1,'visitor can read public picture metadata');
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","aal":"aal2"}',true);
select lives_ok($$select update_editor_profile('ruby','Hello','friends')$$,'owner can restrict current picture');
select set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222","aal":"aal2"}',true);
select set_config('storage.operation','object.get_authenticated',true);
select is((select count(*)::int from storage.objects where bucket_id='profile-pictures'),1,'other MFA editor can see Friends picture');
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","aal":"aal1"}',true);
select is((select count(*)::int from storage.objects where bucket_id='profile-pictures'),0,'password-only owner cannot see Friends picture');
select * from finish();
rollback;
