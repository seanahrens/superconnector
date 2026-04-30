-- Normalize the JSON-array tag-ish columns on people: trajectory_tags
-- and roles still had underscores (the earlier 0008 migration only
-- touched the `tags` table). Rewrites each row's JSON array with
-- lowercase + spaces in place of underscores. Safe to re-run.

UPDATE people
   SET trajectory_tags = (
     SELECT json_group_array(REPLACE(LOWER(TRIM(value)), '_', ' '))
       FROM json_each(people.trajectory_tags)
   )
 WHERE trajectory_tags IS NOT NULL
   AND trajectory_tags <> '[]';

UPDATE people
   SET roles = (
     SELECT json_group_array(REPLACE(LOWER(TRIM(value)), '_', ' '))
       FROM json_each(people.roles)
   )
 WHERE roles IS NOT NULL
   AND roles <> '[]';
