-- Exercises publication, immutable editor membership, MFA, conflicts, and storage signing boundaries.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public,extensions;
select plan(33);
insert into auth.users(id,email) values
 ('11111111-1111-4111-8111-111111111111','ruby@example.invalid'),
 ('22222222-2222-4222-8222-222222222222','jayatci@example.invalid'),
 ('33333333-3333-4333-8333-333333333333','outsider@example.invalid');
insert into public.editor_accounts values ('11111111-1111-4111-8111-111111111111','ruby'),('22222222-2222-4222-8222-222222222222','jayatci');
insert into public.goals(id,title,category,visibility,position) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Public','Travel','public',1),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Private','Other','private',2),
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','Trash','Other','public',3);
update public.goals set deleted_at=now() where title='Trash';
insert into public.goal_participants(goal_id,username) select id,'ruby' from public.goals;
insert into public.memories(id,goal_id,author,occurred_on,note) values
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','ruby',current_date,'Public memory'),
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','ruby',current_date,'Private memory');
insert into public.photos(id,memory_id,width,height,ready) values('ffffffff-ffff-4fff-8fff-ffffffffffff','dddddddd-dddd-4ddd-8ddd-dddddddddddd',100,100,true);
insert into storage.objects(bucket_id,name) values('journal-photos','display/ffffffff-ffff-4fff-8fff-ffffffffffff.webp');
set local role anon;
select set_config('request.jwt.claims','{}',true);
select is((select count(*)::int from goals),1,'anonymous sees only live public goals');
select is((select count(*)::int from memories),1,'anonymous child visibility follows parent');
select is((select count(*)::int from goal_participants),1,'private participant state does not leak');
select throws_ok($$insert into goals(title,category,position) values('Attack','Other',5)$$,'42501',null,'anonymous direct mutation denied');
select set_config('storage.operation','object.sign',true);
select is((select count(*)::int from storage.objects),0,'anonymous signing denied');
select set_config('storage.operation','object.get_authenticated',true);
select is((select count(*)::int from storage.objects),1,'public variant download allowed');
select set_config('storage.operation','object.get_authenticated_info',true);
select is((select count(*)::int from storage.objects),1,'public variant metadata allowed');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"33333333-3333-4333-8333-333333333333","aal":"aal2","user_metadata":{"username":"ruby"}}',true);
select is((select count(*)::int from goals),1,'forged metadata cannot grant private reads');
select throws_ok($$select create_goal('{"title":"Attack","category":"Other","participants":["ruby"]}')$$,'42501','FORBIDDEN','third account cannot mutate');
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","aal":"aal1"}',true);
select is((select count(*)::int from editor_accounts),1,'password session can identify self for MFA enrollment');
select is((select count(*)::int from goals),1,'password session cannot read private goals');
select throws_ok($$select mutate_goal('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,'trash','{}')$$,'42501','FORBIDDEN','password session cannot write');
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","aal":"aal2"}',true);
select is((select count(*)::int from goals),3,'MFA editor sees private content and Trash');
select throws_ok($$update goals set title='Direct'$$,'42501',null,'editor cannot bypass RPC revision guard');
select throws_ok($$select mutate_goal('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',999,'trash','{}')$$,'P0001','CONFLICT','stale drafts rejected');
select lives_ok($$select mutate_goal('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,'complete','{"username":"ruby","completedOn":"2026-10-14"}')$$,'editor completes participant');
select is((select completed_on::text from goal_participants where goal_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),'2026-10-14','completion date persisted');
select lives_ok($$select mutate_goal('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',2,'edit','{"title":"Public","description":"","category":"Travel","visibility":"private","participants":["ruby","jayatci"]}')$$,'publication changed transactionally');
select set_config('storage.operation','object.get_authenticated_info',true);
select is((select count(*)::int from storage.objects),1,'MFA editor can read private photo metadata');
select is((select count(*)::int from goal_participants where goal_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and completed_on is null),1,'shared goal retains one incomplete participant');
select throws_ok($$update photos set ready=true,width=99999 where id='ffffffff-ffff-4fff-8fff-ffffffffffff'$$,'23514',null,'invalid normalized photo dimensions rejected');
select lives_ok($$select reserve_photo('dddddddd-dddd-4ddd-8ddd-dddddddddddd','') from generate_series(1,9)$$,'nine reservations plus ready photo fit the cap');
select throws_ok($$select reserve_photo('dddddddd-dddd-4ddd-8ddd-dddddddddddd','overflow')$$,'P0001','PHOTO_LIMIT','pending reservations count toward attachment limit');
select throws_ok($$select mutate_memory('dddddddd-dddd-4ddd-8ddd-dddddddddddd',99,'delete','{}')$$,'P0001','CONFLICT','memory revision conflicts rejected');
select lives_ok($$select mutate_memory('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',1,'delete','{}')$$,'editor can soft delete memory');
select set_config('storage.operation','object.sign',true);
select is((select count(*)::int from storage.objects),0,'MFA editor cannot sign variants');
select set_config('storage.operation','object.sign_many',true);
select is((select count(*)::int from storage.objects),0,'batch signing denied');
select set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222","aal":"aal2"}',true);
select lives_ok($$select mutate_goal('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',1,'trash','{}')$$,'other editor can manage Ruby goal');
select throws_ok($$select create_memory('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',current_date,'Rejected')$$,'P0001','NOT_FOUND','new memories on Trash denied');
select throws_ok($$select reserve_photo('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','Rejected')$$,'P0001','NOT_FOUND','deleted memory reservations denied');
reset role;
set local role anon;
select set_config('request.jwt.claims','{}',true);
select is((select count(*)::int from memories),0,'privacy change removes public memories');
select set_config('storage.operation','object.get_authenticated',true);
select is((select count(*)::int from storage.objects),0,'privacy change blocks subsequent downloads');
select set_config('storage.operation','object.get_authenticated_info',true);
select is((select count(*)::int from storage.objects),0,'privacy change blocks subsequent metadata reads');
select * from finish();
rollback;
