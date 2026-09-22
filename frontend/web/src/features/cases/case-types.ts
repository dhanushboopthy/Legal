// Offered as a list rather than free text (F-27). The server stores the label
// as a plain string, so adding a type here needs no backend change.
export const CASE_TYPES = [
  'Civil',
  'Criminal',
  'Family',
  'Property',
  'Commercial',
  'Labour and service',
  'Tax',
  'Consumer',
  'Writ petition',
  'Other',
] as const
