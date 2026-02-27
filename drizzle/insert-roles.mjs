import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL);

// Insert Ethan as internal user
await sql`
  INSERT INTO user_roles (clerk_user_id, role, creator_id, assigned_creator_ids)
  VALUES ('user_39oMHrttThSlbvWwuisCJ1lGMMK', 'internal', NULL, NULL)
  ON CONFLICT (clerk_user_id) DO UPDATE SET role = 'internal'
`;
console.log("Inserted internal role for Ethan (user_39oMHrttThSlbvWwuisCJ1lGMMK)");

// Verify
const roles = await sql`SELECT * FROM user_roles`;
console.log("Current roles:", roles);

await sql.end();
