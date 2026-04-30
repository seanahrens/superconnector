-- Standardize tag word separators on space (not underscore). Slash stays
-- as the namespace separator. Lowercase + collapse whitespace.

UPDATE tags
   SET name = TRIM(LOWER(REPLACE(name, '_', ' ')))
 WHERE name LIKE '%\_%' ESCAPE '\' OR name <> LOWER(name);

UPDATE tag_proposals
   SET proposed_name = TRIM(LOWER(REPLACE(proposed_name, '_', ' ')))
 WHERE proposed_name LIKE '%\_%' ESCAPE '\' OR proposed_name <> LOWER(proposed_name);
