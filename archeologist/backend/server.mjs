/*import http from 'http';
import { tmpdir } from 'os';
import path from 'path';
import fs from 'fs-extra';
import simpleGit from 'simple-git';
import { request } from 'http';
import axios from 'axios';

const port = process.env.PORT || 3000;
const CLONE_API_HOST = 'web';
const CLONE_API_PORT = 5000;
const ANALYZE_API_URL = 'http://localhost:3000/api/analyze';

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/analyze-archeologist") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", async () => {
      console.log("Received analyze request:", body);
      try {
        const { repo_url } = JSON.parse(body);
        if (!repo_url) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "repo_url is required" }));
          return;
        }
        /*const { clone_path } = JSON.parse(body);
        if (!clone_path) {
          clone_path = cloneOrUpdateRepo(repo_url);
          return;
        }*/

        // 2. Poursuivre analyse sur clonePath
        /*const repoGit = simpleGit(clone_path);


        const branchSummary = await repoGit.branch(['-r']);
        const remoteBranches = Object.keys(branchSummary.branches).filter(b => b.startsWith('origin/') && !b.endsWith('HEAD'));

        const commitsMap = new Map();

        for (const remoteBranch of remoteBranches) {
          const localBranch = remoteBranch.replace('origin/', 'tmp-branch-');
          try { await repoGit.deleteLocalBranch(localBranch, true); } catch {}

          await repoGit.checkoutBranch(localBranch, remoteBranch);

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

        const contributorsCount = {};
        commits.forEach(c => {
          contributorsCount[c.author] = (contributorsCount[c.author] || 0) + 1;
        });
        const contributors = Object.entries(contributorsCount).map(([name, commits]) => ({ name, commits }));

        let file_changes = {};
        for (const commit of commits) {
          const parentsRaw = await repoGit.raw(['rev-list', '--parents', '-n', '1', commit.sha]);
          const parts = parentsRaw.trim().split(' ');
          if (parts.length < 2) continue;
          const parentSha = parts[1];

          const diffSummary = await repoGit.diffSummary([parentSha, commit.sha]);
          diffSummary.files.forEach(f => {
            file_changes[f.file] = (file_changes[f.file] || 0) + f.changes;
          });
        }

        const analysisData = {
          clone_path,
          repo_url,
          status: "completed",
          commits,
          contributors,
          file_changes,
          analyzed_at: new Date().toISOString()
        };*/

         // Appel HTTP vers /api/analyze dans app.mjs
        /*const analyzeResponse = await axios.post(ANALYZE_API_URL, { repoUrl: repo_url });

        const responseData = {
          repo_url,
          //clone_path,
          status: analyzeResponse.data.status || "completed",
          analyzed_at: new Date().toISOString(),
          results: analyzeResponse.data,
        };


        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(responseData));

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
  console.log(`Hein ${port}`);
});


//Forcer le clonage ou la mise à jour du dépôt
// en appelant l'API Python
function cloneOrUpdateRepo(repo_url) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ repo_url });

    const options = {
      hostname: CLONE_API_HOST,
      port: CLONE_API_PORT,
      path: '/api/clone',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = request(options, (res) => {
      let data = "";
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsed = JSON.parse(data);
            if (!parsed.clone_path) {
              reject(new Error("Response from /api/clone missing clone_path"));
              return;
            }
            resolve(parsed.clone_path);
          } catch (e) {
            reject(e);
          }
        } else {
          reject(new Error(`Failed to clone repo: ${res.statusCode} ${res.statusMessage}`));
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.write(postData);
    req.end();
  });
}*/
