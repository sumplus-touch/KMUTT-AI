import readline from "readline";
import { save, load, configPath, DEFAULT_HOST } from "../config";
import { api, ApiError } from "../api";
import { t, g } from "../ui/theme";
import { printProblem } from "../ui/message";
import { msg as en } from "../i18n";

/** Read a line without echoing it — a token is a credential. */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = process.stdout as any;
    const onData = () => { out.write("\x1b[2K\r" + question); };
    process.stdout.write(question);
    (rl as any)._writeToOutput = onData;
    rl.question("", (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

export async function login(opts: { token?: string; host?: string }) {
  const host = opts.host || load().host || DEFAULT_HOST;
  const token = opts.token || (await promptHidden(`  Access token for ${host}: `));

  if (!token) {
    console.error(`${t.stop(g.stop)} No token entered.`);
    return 1;
  }

  save({ host, token });

  // Verify rather than claiming success on an unchecked value.
  try {
    await api.settings();
    console.log("");
    console.log(`  ${t.ok(g.ok)} Signed in to ${t.key(host)}`);
    console.log(`  ${t.muted(`Saved to ${configPath()}`)}`);
    console.log("");
    return 0;
  } catch (err: any) {
    if (err instanceof ApiError && err.code === "NOT_AUTHENTICATED") {
      printProblem({
        code: "TOKEN_REJECTED",
        title: "That token was rejected",
        body: `The server at ${host} did not accept it. Check for a trailing space when pasting.`,
        fix: "kmutt login",
      });
    } else {
      printProblem(en.SERVER_UNREACHABLE(host));
    }
    return 1;
  }
}
