-- ONE-TIME UPDATE for the database you already have. Run it once in Supabase > SQL Editor.
-- It adds "sex" to people and "audience" to awards. It does NOT delete any votes, people or awards.

alter table people add column if not exists sex text;

update people set sex = 'female'
where lower(trim(name)) in ('ebube', 'odinaka', 'chioma', 'chinekwu');

update people set sex = 'male' where sex is null;

alter table people alter column sex set default 'male';
alter table people alter column sex set not null;
alter table people drop constraint if exists people_sex_check;
alter table people add constraint people_sex_check check (sex in ('male', 'female'));

alter table awards add column if not exists audience text not null default 'all';
alter table awards drop constraint if exists awards_audience_check;
alter table awards add constraint awards_audience_check check (audience in ('all', 'male', 'female'));

-- Shows the result so you can check it: 4 females, 5 males.
select name, sex from people order by sex, name;
