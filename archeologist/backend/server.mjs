import http from 'http';
import { tmpdir } from 'os';
import path from 'path';
import fs from 'fs-extra';
import simpleGit from 'simple-git';

const port = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/analyze") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", async () => {
      try {
        const { repo_url } = JSON.parse(body);
        if (!repo_url) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "repo_url is required" }));
          return;
        }

        const repoDir = path.join(tmpdir(), `repo_${Date.now()}`);
        await fs.mkdirp(repoDir);

        const git = simpleGit();

        const token = process.env.GITHUB_TOKEN; // stocke ton token dans une variable d'environnement
        const repoUrlWithToken = repo_url.replace(
          'https://github.com/',
          `https://${token}@github.com/`
        );

        await git.clone(repoUrlWithToken, repoDir);

        const repoGit = simpleGit(repoDir);

        // Assure un clone complet, pas shallow
        await ensureFullClone(repoDir);

        // Récupérer toutes les branches distantes (ex: origin/main, origin/dev ...)
        const branchSummary = await repoGit.branch(['-r']);
        const remoteBranches = Object.keys(branchSummary.branches).filter(b => b.startsWith('origin/') && !b.endsWith('HEAD'));

        // Map pour stocker les commits uniques, clé = sha
        const commitsMap = new Map();

        for (const remoteBranch of remoteBranches) {
          // Checkout sur la branche distante en local
          // Création d'une branche locale temporaire pointant sur la branche distante
          const localBranch = remoteBranch.replace('origin/', 'tmp-branch-');
          // Supprimer la branche locale si existe déjà (pour être safe)
          try { await repoGit.deleteLocalBranch(localBranch, true); } catch {}

          await repoGit.checkoutBranch(localBranch, remoteBranch);

          // Récupérer commits de cette branche (limitons à 150 derniers)
          const log = await repoGit.log({ maxCount: 150 });

          log.all.forEach(c => {
            if (!commitsMap.has(c.hash)) {
              commitsMap.set(c.hash, {
                sha: c.hash,
                message: c.message,
                author: c.author_name,
                date: c.date
              });
            }
          });
        }

        const commits = Array.from(commitsMap.values());

        // Compte commits par auteur
        const contributorsCount = {};
        commits.forEach(c => {
          contributorsCount[c.author] = (contributorsCount[c.author] || 0) + 1;
        });
        const contributors = Object.entries(contributorsCount).map(([name, commits]) => ({ name, commits }));

        // Calcul des changements sur fichiers cumulés sur tous les commits
        let file_changes = {};
        for (const commit of commits) {
          const parentsRaw = await repoGit.raw(['rev-list', '--parents', '-n', '1', commit.sha]);
          const parts = parentsRaw.trim().split(' ');

          if (parts.length < 2) {
            // Commit racine, pas de parent, on ignore diff
            continue;
          }
          const parentSha = parts[1];

          const diffSummary = await repoGit.diffSummary([parentSha, commit.sha]);
          diffSummary.files.forEach(f => {
            file_changes[f.file] = (file_changes[f.file] || 0) + f.changes;
          });
        }

        // Cleanup
        await fs.remove(repoDir);

        const analysisData = {
          repo_url,
          status: "completed",
          commits,
          contributors,
          file_changes,
          analyzed_at: new Date().toISOString()
        };

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(analysisData));

      } catch (error) {
        console.error('Analyse error:', error);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: error.message }));
      }
    });
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(port, () => {
  console.log(`Archeologist server listening on port ${port}`);
});

async function ensureFullClone(repoPath) {
  const git = simpleGit(repoPath);
  const isShallow = await git.revparse(['--is-shallow-repository']);
  if (isShallow === 'true') {
    console.log('Shallow repository detected, fetching full history...');
    await git.fetch(['--unshallow']);
    console.log('Full history fetched.');
  } else {
    console.log('Repository is already complete.');
  }
}
