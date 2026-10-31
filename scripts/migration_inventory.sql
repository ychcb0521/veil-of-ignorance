-- One statement, read-only snapshot. No user record contents leave the database.
WITH names AS (
  SELECT schemaname, tablename
  FROM pg_tables WHERE schemaname IN ('public','auth','storage')
), counts AS (
  SELECT schemaname, tablename,
    ((xpath('/row/n/text()', query_to_xml(
      format('SELECT count(*) AS n FROM %I.%I', schemaname, tablename), false, true, '')))[1]::text)::bigint AS row_count
  FROM names
)
SELECT json_build_object(
  'captured_at', now(),
  'server_version', current_setting('server_version'),
  'tables', (SELECT json_agg(json_build_object('schema_name',schemaname,'table_name',tablename,'row_count',row_count) ORDER BY schemaname,tablename) FROM counts),
  'public_policies', (SELECT count(*) FROM pg_policies WHERE schemaname='public'),
  'public_rls_tables', (SELECT count(*) FROM pg_tables WHERE schemaname='public' AND rowsecurity)
);
