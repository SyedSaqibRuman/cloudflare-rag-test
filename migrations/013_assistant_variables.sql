-- Add assistant_variables JSON column to assistants
ALTER TABLE assistants
  ADD COLUMN assistant_variables JSON NULL AFTER system_prompt;
