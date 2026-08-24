import { api } from "../api";
import { t } from "../ui/theme";

const COMMANDS = ["ask", "search", "add", "ls", "show", "reindex", "rm", "doctor", "login", "completion"];
const CATEGORIES = ["regulations", "enrollment", "financial", "research", "other"];

/**
 * Shell completion.
 *
 * `--ids` hits the API so document IDs complete for `show`, `reindex` and
 * `rm`; the shell functions below call it lazily, so no network happens until
 * the user actually Tab-completes an ID.
 */
export async function completion(shell: string, opts: { ids?: boolean }) {
  if (opts.ids) {
    try {
      const docs = await api.documents();
      console.log(docs.map((d) => d.id.slice(0, 6)).join(" "));
    } catch {
      console.log("");
    }
    return 0;
  }

  if (shell === "bash") {
    console.log(`# kmutt bash completion — add to ~/.bashrc:
#   source <(kmutt completion bash)
_kmutt() {
  local cur prev
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  case "\$prev" in
    show|reindex|rm) COMPREPLY=( \$(compgen -W "\$(kmutt completion --ids)" -- "\$cur") ); return ;;
    --category)      COMPREPLY=( \$(compgen -W "${CATEGORIES.join(" ")}" -- "\$cur") ); return ;;
  esac
  COMPREPLY=( \$(compgen -W "${COMMANDS.join(" ")} --json --no-color --lang --yes" -- "\$cur") )
}
complete -F _kmutt kmutt`);
    return 0;
  }

  if (shell === "zsh") {
    console.log(`# kmutt zsh completion — add to ~/.zshrc:
#   source <(kmutt completion zsh)
_kmutt() {
  local -a cmds
  cmds=(${COMMANDS.map((c) => `'${c}'`).join(" ")})
  if [[ \$words[2] == (show|reindex|rm) && \$CURRENT == 3 ]]; then
    compadd \${(z)"\$(kmutt completion --ids)"}
  elif [[ \$words[CURRENT-1] == "--category" ]]; then
    compadd ${CATEGORIES.join(" ")}
  else
    compadd \$cmds
  fi
}
compdef _kmutt kmutt`);
    return 0;
  }

  if (shell === "powershell") {
    console.log(`# kmutt PowerShell completion — add to $PROFILE:
Register-ArgumentCompleter -Native -CommandName kmutt -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  $cmds = @(${COMMANDS.map((c) => `'${c}'`).join(",")})
  $cmds | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
  }
}`);
    return 0;
  }

  console.error(`Unknown shell "${shell}". Supported: bash, zsh, powershell`);
  return 1;
}
