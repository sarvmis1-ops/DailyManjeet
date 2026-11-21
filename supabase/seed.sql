-- =====================================================================
-- LifeOS Study Edition — optional starter data
-- Run AFTER schema.sql and AFTER you have signed up once in the app
-- (Supabase → Authentication → Users must show your user).
-- Change v_email below to the email you log in with.
-- Runs only once per user: skipped if that user already has quotes.
-- =====================================================================

do $$
declare
  v_email  text := 'YOUR_LOGIN_EMAIL';
  v_uid    uuid;
  v_start  date := current_date - 3;
begin
  select id into v_uid from auth.users where email = v_email;
  if v_uid is null then
    raise notice 'No auth user with email %, seed skipped. Sign up in the app first.', v_email;
    return;
  end if;

  if exists (select 1 from public.quotes where user_id = v_uid) then
    raise notice 'Seed data already present for %, skipped.', v_email;
    return;
  end if;

  insert into public.quotes (user_id, text, author) values
    (v_uid, 'Discipline is choosing between what you want now and what you want most.', 'Abraham Lincoln'),
    (v_uid, 'Small daily improvements are the key to staggering long-term results.', 'Robin Sharma'),
    (v_uid, 'Padhai ek din ka kaam nahi, roz ki aadat hai.', 'LifeOS');

  insert into public.accounts (user_id, name, balance) values
    (v_uid, 'Cash', 2500.00),
    (v_uid, 'UPI', 4200.00),
    (v_uid, 'Bank A/c 1', 18000.00);

  insert into public.finance (user_id, type, category, amount, account, note, date) values
    (v_uid, 'income',  'Salary',    25000.00, 'Bank A/c 1', 'Monthly salary', current_date - 5),
    (v_uid, 'expense', 'Books',       650.00, 'UPI',        'Reasoning practice book', current_date - 2),
    (v_uid, 'expense', 'Food',        180.00, 'Cash',       'Canteen', current_date - 1);

  insert into public.tasks (user_id, title, due, priority, notes, status) values
    (v_uid, 'Revise Polity chapter 3',      current_date,     'high',   'Fundamental Rights', 'open'),
    (v_uid, 'Solve 20 quant questions',     current_date,     'normal', 'Percentage + Ratio', 'open'),
    (v_uid, 'Submit mock test analysis',    current_date + 2, 'low',    '',                   'open');

  insert into public.projects (user_id, name, status, description, remarks) values
    (v_uid, 'Exam preparation plan', 'In-Progress', '90-day study schedule',
     jsonb_build_array(jsonb_build_object('d', current_date::text, 'r', 'Week 1 started')));

  insert into public.syllabus (user_id, subject, chapter, sub, status) values
    (v_uid, 'History',   'Modern India',        'Revolt of 1857', 'done'),
    (v_uid, 'History',   'Modern India',        'Gandhian Era',   'pending'),
    (v_uid, 'Geography', 'Physical Geography',  'Climatology',    'pending');

  -- review dates follow the app's SR intervals: 1,3,5,7,15,30,60,90 days
  insert into public.learning (user_id, topic, subject, notes, start_date, review_dates, done_dates)
  select v_uid, 'Fundamental Rights', 'Polity', 'Articles 12-35', v_start,
         array(select v_start + n from unnest(array[1,3,5,7,15,30,60,90]) as n),
         array[v_start + 1];

  insert into public.habits (user_id, name, start_date, days, streak, status) values
    (v_uid, 'Wake up at 5 AM', current_date - 2,
     jsonb_build_array(
       jsonb_build_object('d', (current_date - 2)::text, 'r', ''),
       jsonb_build_object('d', (current_date - 1)::text, 'r', 'Tough but done')),
     2, 'active');

  insert into public.health (user_id, type, value, unit, meal, note, date) values
    (v_uid, 'water',    '2.5',   'L',   null,        '',             current_date),
    (v_uid, 'meal',     '450',   'kcal','Breakfast', 'Poha + chai',  current_date),
    (v_uid, 'wakeup',   '05:10', '',    null,        '',             current_date);

  raise notice 'Seed data inserted for %', v_email;
end;
$$;
