-- Storage checks object metadata before serving private journal or profile images.
-- Allow that read under the same per-image visibility rules as downloads.
alter policy journal_download on storage.objects
  using (
    bucket_id = 'journal-photos'
    and storage.allow_any_operation(array['object.get_authenticated', 'object.get_authenticated_info'])
    and journal_private.can_read_object(name)
  );

alter policy profile_picture_download on storage.objects
  using (
    bucket_id = 'profile-pictures'
    and storage.allow_any_operation(array['object.get_authenticated', 'object.get_authenticated_info'])
    and journal_private.can_read_profile_picture(name)
  );
