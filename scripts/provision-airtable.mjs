import { readFile } from "node:fs/promises";

const shouldApply = process.argv.includes("--apply");
const env = await loadLocalEnv();
const token = env.AIRTABLE_ACCESS_TOKEN;
const baseId = env.AIRTABLE_BASE_ID;
if (!token || !baseId)
  throw new Error(
    "AIRTABLE_ACCESS_TOKEN and AIRTABLE_BASE_ID are required in .env.local.",
  );

const definitions = [
  table("PL Organizations", [
    text("Name"),
    text("Slug"),
    select("Storage Mode", ["native", "airtable"]),
    dateTime("Updated At"),
  ]),
  table("PL Events", [
    text("Organization ID"),
    text("Name"),
    text("Slug"),
    text("Timezone"),
    dateTime("Starts At"),
    dateTime("Ends At"),
    text("Venue"),
    text("Source Event ID"),
    text("Source Template ID"),
    text("Creation Operation ID"),
    select("Status", ["draft", "active", "archived"]),
    dateTime("Updated At"),
  ]),
  table("PL CFP Forms", [
    text("Event ID"),
    text("Name"),
    text("Slug"),
    dateTime("Opens At"),
    dateTime("Closes At"),
    checkbox("Published"),
    longText("Configuration JSON"),
    dateTime("Updated At"),
  ]),
  table("PL Form Fields", [
    text("Event ID"),
    text("Form ID"),
    text("Section"),
    text("Type"),
    text("Key"),
    text("Label"),
    longText("Description"),
    text("Placeholder"),
    checkbox("Required"),
    checkbox("Searchable"),
    longText("Options JSON"),
    longText("Validation JSON"),
    number("Position"),
  ]),
  table("PL Event Templates", [
    text("Organization ID"),
    text("Source Event ID"),
    text("Name"),
    text("Slug"),
    longText("Description"),
    number("Version"),
    longText("Domains JSON"),
    longText("Configuration JSON"),
    dateTime("Updated At"),
  ]),
  table("PL Event Program Settings", [
    text("Event ID"),
    longText("Reviewer Routing JSON"),
    longText("Reminder Rules JSON"),
    longText("Locations JSON"),
    longText("Formats JSON"),
    longText("Content Workflow JSON"),
    longText("CRM Handoff Defaults JSON"),
    dateTime("Updated At"),
  ]),
  table("PL CRM Fields", [
    text("Organization ID"),
    text("Name"),
    text("Type"),
    longText("Options JSON"),
    number("Position"),
  ]),
  table("PL Submissions", [
    text("Event ID"),
    text("Form ID"),
    text("Title"),
    longText("Abstract"),
    select("Status", [
      "draft",
      "pending",
      "accepted_queue",
      "accepted",
      "decline_queue",
      "declined",
      "withdrawn",
    ]),
    select("Decision State", [
      "none",
      "acceptance_staged",
      "waitlist_staged",
      "rejection_staged",
      "accepted",
      "waitlisted",
      "rejected",
    ]),
    longText("Tags JSON"),
    longText("Answers JSON"),
    dateTime("Submitted At"),
    dateTime("Updated At"),
  ]),
  table("PL Submission Tags", [
    text("Organization ID"),
    text("Event ID"),
    text("Name"),
    text("Color"),
    dateTime("Created At"),
  ]),
  table("PL Speakers", [
    text("Organization ID"),
    email("Email"),
    text("First Name"),
    text("Last Name"),
    text("Job Title"),
    text("Company"),
    longText("Biography"),
    longText("Social JSON"),
    longText("Logistics JSON"),
    select("Portal Status", ["not_invited", "invited", "active", "complete"]),
    dateTime("Updated At"),
  ]),
  table("PL Reviews", [
    text("Round ID"),
    text("Submission ID"),
    text("Reviewer ID"),
    number("Weighted Score"),
    select("Recommendation", ["approve", "maybe", "deny"]),
    longText("Comment"),
    number("AI Score"),
    longText("AI Reasoning"),
    checkbox("Human Override"),
    dateTime("Updated At"),
  ]),
  table("PL Review Conflicts", [
    text("Event ID"),
    text("Round ID"),
    text("Assignment ID"),
    text("Submission ID"),
    text("Reviewer ID"),
    select("Type", ["recusal", "declared", "detected"]),
    longText("Reason"),
    select("Status", ["unresolved", "resolved", "overridden"]),
    longText("Resolution Note"),
    dateTime("Resolved At"),
    dateTime("Created At"),
  ]),
  table("PL Speaker Tasks", [
    text("Event ID"),
    text("Speaker ID"),
    text("Title"),
    select("Status", [
      "todo",
      "in_progress",
      "submitted",
      "complete",
      "needs_changes",
    ]),
    dateTime("Due At"),
    longText("Response JSON"),
    dateTime("Updated At"),
  ]),
  table("PL Agenda Items", [
    text("Event ID"),
    text("Session ID"),
    text("Track ID"),
    text("Room ID"),
    text("Title"),
    dateTime("Starts At"),
    dateTime("Ends At"),
    select("Status", ["draft", "pending_approval", "approved", "published"]),
    dateTime("Updated At"),
  ]),
  table("PL Schedule Conflicts", [
    text("Event ID"),
    text("Agenda Item ID"),
    text("Conflicting Item ID"),
    select("Type", ["room", "speaker"]),
    longText("Summary"),
    text("Room ID"),
    dateTime("Starts At"),
    dateTime("Ends At"),
    select("Status", ["open", "resolved", "dismissed"]),
    dateTime("Resolved At"),
    dateTime("Created At"),
  ]),
  table("PL CRM Contacts", [
    text("Organization ID"),
    email("Email"),
    text("First Name"),
    text("Last Name"),
    text("Company"),
    text("Job Title"),
    longText("Biography"),
    longText("Tags JSON"),
    text("Source"),
    dateTime("Updated At"),
  ]),
  table("PL Pipeline Cards", [
    text("Organization ID"),
    text("Contact ID"),
    select("Stage", [
      "researching",
      "identified",
      "approved",
      "contacted",
      "interested",
      "confirmed",
      "future_fit",
      "declined",
    ]),
    number("Score"),
    longText("Rationale"),
    dateTime("Updated At"),
  ]),
];

const existingResponse = await airtable(`/meta/bases/${baseId}/tables`);
const existing = new Map(
  existingResponse.tables.map((item) => [item.name, item]),
);
const missing = definitions.filter((item) => !existing.has(item.name));
const missingFields = definitions.flatMap((definition) => {
  const current = existing.get(definition.name);
  if (!current) return [];
  const names = new Set(current.fields.map((field) => field.name));
  return definition.fields
    .filter((field) => !names.has(field.name))
    .map((field) => ({ table: current, field }));
});

if (!missing.length && !missingFields.length) {
  console.log(
    `Airtable schema is current (${definitions.length} ProgramLoom tables).`,
  );
  process.exit(0);
}

if (!shouldApply) {
  if (missing.length)
    console.log(
      `Dry run: ${missing.length} table(s) would be created: ${missing.map((item) => item.name).join(", ")}`,
    );
  if (missingFields.length)
    console.log(
      `Dry run: ${missingFields.length} field(s) would be added: ${missingFields.map(({ table, field }) => `${table.name}.${field.name}`).join(", ")}`,
    );
  process.exit(0);
}

for (const definition of missing) {
  await airtable(`/meta/bases/${baseId}/tables`, {
    method: "POST",
    body: JSON.stringify(definition),
  });
  console.log(`Created ${definition.name}`);
}
for (const { table: current, field } of missingFields) {
  await airtable(`/meta/bases/${baseId}/tables/${current.id}/fields`, {
    method: "POST",
    body: JSON.stringify(field),
  });
  console.log(`Created ${current.name}.${field.name}`);
}
console.log(
  `Airtable schema provisioned (${definitions.length} ProgramLoom tables).`,
);

async function airtable(path, init = {}) {
  const response = await fetch(`https://api.airtable.com/v0${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      `Airtable schema request failed with status ${response.status}.`,
    );
  }
  return response.json();
}

async function loadLocalEnv() {
  const source = await readFile(
    new URL("../.env.local", import.meta.url),
    "utf8",
  );
  return Object.fromEntries(
    source
      .split(/\r?\n/)
      .filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line))
      .map((line) => {
        const index = line.indexOf("=");
        let value = line.slice(index + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        )
          value = value.slice(1, -1);
        return [line.slice(0, index), value];
      }),
  );
}

function table(name, fields) {
  return {
    name,
    fields: [{ name: "ProgramLoom ID", type: "singleLineText" }, ...fields],
  };
}
function text(name) {
  return { name, type: "singleLineText" };
}
function email(name) {
  return { name, type: "email" };
}
function longText(name) {
  return { name, type: "multilineText" };
}
function checkbox(name) {
  return {
    name,
    type: "checkbox",
    options: { icon: "check", color: "greenBright" },
  };
}
function dateTime(name) {
  return {
    name,
    type: "dateTime",
    options: {
      dateFormat: { name: "iso" },
      timeFormat: { name: "24hour" },
      timeZone: "utc",
    },
  };
}
function number(name) {
  return { name, type: "number", options: { precision: 2 } };
}
function select(name, choices) {
  return {
    name,
    type: "singleSelect",
    options: { choices: choices.map((choice) => ({ name: choice })) },
  };
}
