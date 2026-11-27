// 发布到自有服务器（取代 wrangler deploy）。在本机运行：
//   node deploy/release.mjs                 构建 → 上传 → 切换 → 重启 → 健康检查
//   node deploy/release.mjs --skip-build    用现有构建产物
//   node deploy/release.mjs --static        只同步大素材（pets、stickers 等，首次或素材变化时）
//   node deploy/release.mjs --rollback      切回上一个版本
// 每次发布一个新目录 /meme/app/releases/<时间-提交>，current 软链接指向它，保留最近 5 个。
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const HOST = process.env.MEME_HOST || 'root@your-server'
const KEY = process.env.MEME_SSH_KEY || path.join(os.homedir(), '.ssh', 'meme_server')
// 大素材放 /meme/static，发布目录里用软链接，避免每次上传几百 MB
const STATIC_DIRS = ['pets', 'novel-data', 'mini-cdn', 'stickers', 'wallpapers']
const args = new Set(process.argv.slice(2))
const sh = (cmd, a, opts = {}) => execFileSync(cmd, a, { stdio: 'inherit', shell: process.platform === 'win32' && cmd === 'npx', ...opts })
const ssh = (script) => { const r = spawnSync('ssh', ['-i', KEY, '-o', 'BatchMode=yes', HOST, 'bash -se'], { input: script, stdio: ['pipe', 'inherit', 'inherit'] }); if (r.status !== 0) throw Error('远程命令失败'); }
const upload = (local, remote) => sh('scp', ['-i', KEY, '-o', 'BatchMode=yes', '-q', local, `${HOST}:${remote}`])
const step = (s) => console.log('\n▶ ' + s)
// 打包文件放仓库内的相对路径：GNU tar 会把 C:\... 里的冒号当成远程主机
const WORK = path.join('.build', 'release'); fs.mkdirSync(WORK, { recursive: true })
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim()

// 发布锁：同一个仓库（含所有 git 工作区）同一时间只允许一个发布。多个会话同时发布会共用 web/dist、连续重启服务。
// 不排队等待：等待期间 main 可能多了没确认过的提交，应由发起者看过之后再重新运行。
const LOCK = path.join(path.resolve(git('rev-parse', '--git-common-dir')), 'meme-release.lock')
const alive = (pid) => { try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } }
for (let tries = 0; ; tries++) {
  try { fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, at: new Date().toISOString(), cwd: process.cwd() }), { flag: 'wx' }); break }
  catch (e) {
    if (e.code !== 'EEXIST') throw e
    let other = null; try { other = JSON.parse(fs.readFileSync(LOCK, 'utf8')) } catch {}
    const fresh = !other && Date.now() - (fs.statSync(LOCK, { throwIfNoEntry: false })?.mtimeMs ?? 0) < 5000 // 对方刚建好文件，内容还没写完
    if (fresh || (other && alive(other.pid)) || tries >= 2) {
      console.error(`已有发布在进行（PID ${other?.pid ?? '?'}，${other?.at ?? '刚开始'}，${other?.cwd ?? ''}）。等它结束，确认 main 上的提交都可以上线后再运行。
确定没有发布在跑时，可删除 ${LOCK}`)
      process.exit(1)
    }
    fs.rmSync(LOCK, { force: true }) // 上次异常退出留下的
  }
}
process.on('exit', () => { try { if (JSON.parse(fs.readFileSync(LOCK, 'utf8')).pid === process.pid) fs.rmSync(LOCK) } catch {} })
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(130))

if (args.has('--rollback')) {
  step('切回上一个版本')
  ssh(`set -e; exec 9>/run/meme-release.lock; flock -n 9 || { echo 服务器上已有发布在进行; exit 1; }; cd /meme/app/releases; prev=$(ls -1 | sort | tail -2 | head -1); cur=$(readlink -f /meme/app/current); [ "$prev" ] && [ "/meme/app/releases/$prev" != "$cur" ] || { echo 没有可回滚的版本; exit 1; }
ln -sfn /meme/app/releases/$prev /meme/app/current.new && mv -T /meme/app/current.new /meme/app/current && systemctl restart meme-hall && echo 已回滚到 $prev`)
  process.exit(0)
}

if (args.has('--static')) {
  for (const dir of STATIC_DIRS) {
    if (!fs.existsSync(path.join('public', dir))) continue
    step('同步素材 ' + dir)
    const tar = path.join(WORK, `meme-static-${dir}.tar`).split(path.sep).join('/')
    sh('tar', ['-cf', tar, '-C', 'public', dir])
    upload(tar, `/tmp/meme-static-${dir}.tar`)
    ssh(`set -e; rm -rf /meme/static/${dir}.new; mkdir -p /meme/static/${dir}.new; tar -xf /tmp/meme-static-${dir}.tar -C /meme/static/${dir}.new --strip-components=1; rm -rf /meme/static/${dir}.old; [ -d /meme/static/${dir} ] && mv /meme/static/${dir} /meme/static/${dir}.old; mv /meme/static/${dir}.new /meme/static/${dir}; rm -rf /meme/static/${dir}.old /tmp/meme-static-${dir}.tar; chown -R meme:meme /meme/static/${dir}; echo $(find /meme/static/${dir} -type f | wc -l) 个文件`)
    fs.rmSync(tar)
  }
  process.exit(0)
}

const commit = git('rev-parse', '--short', 'HEAD')
const dirtyNow = () => git('status', '--porcelain', '--', 'src', 'web', 'public', 'server', 'migrations', 'wrangler.toml')
const dirty = dirtyNow()
if (dirty && !args.has('--allow-dirty')) throw Error('有未提交的改动，先提交再发布：\n' + dirty)
const id = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13) + '-' + commit

if (!args.has('--skip-build')) {
  step('构建前端与服务器版')
  sh('npx', ['tsc', '--noEmit']); sh('npx', ['vite', 'build']); sh('node', ['scripts/check-bundle.mjs']); sh('node', ['server/build.mjs'])
}

step('打包 ' + id)
const stage = path.join(WORK, 'stage-' + id); fs.rmSync(stage, { recursive: true, force: true }); fs.mkdirSync(stage, { recursive: true })
fs.mkdirSync(path.join(stage, 'server', 'dist'), { recursive: true })
for (const f of ['main.mjs', 'd1.mjs', 'r2.mjs', 'runtime.mjs', 'vars.json']) fs.copyFileSync(path.join('server', f), path.join(stage, 'server', f))
fs.copyFileSync('server/dist/app.mjs', path.join(stage, 'server', 'dist', 'app.mjs'))
fs.cpSync('web/dist/client', path.join(stage, 'client'), { recursive: true, filter: (src) => !STATIC_DIRS.some((d) => path.resolve(src) === path.resolve('web/dist/client', d)) })
fs.cpSync('migrations', path.join(stage, 'migrations'), { recursive: true })
fs.writeFileSync(path.join(stage, 'RELEASE'), JSON.stringify({ id, commit, at: new Date().toISOString() }) + '\n')
const tar = path.join(WORK, `meme-${id}.tar.gz`).split(path.sep).join('/')
sh('tar', ['-czf', tar, '-C', stage.split(path.sep).join('/'), '.'])
fs.rmSync(stage, { recursive: true, force: true })
console.log((fs.statSync(tar).size / 1048576).toFixed(1) + ' MB')
// 构建和打包期间代码变了（别的会话合并了 main、改了文件），产物就和提交号对不上
if (git('rev-parse', '--short', 'HEAD') !== commit || (dirtyNow() !== dirty)) { fs.rmSync(tar); throw Error('构建期间代码有变化（HEAD 或工作区），已停止，未上传。确认后重新运行') }

step('上传并切换')
upload(tar, `/tmp/meme-${id}.tar.gz`)
fs.rmSync(tar)
ssh(`set -e
exec 9>/run/meme-release.lock; flock -n 9 || { echo 服务器上已有发布在进行，未切换; rm -f /tmp/meme-${id}.tar.gz; exit 1; }
R=/meme/app/releases/${id}
mkdir -p $R && tar -xzf /tmp/meme-${id}.tar.gz -C $R && rm -f /tmp/meme-${id}.tar.gz
for d in ${STATIC_DIRS.join(' ')}; do [ -d /meme/static/$d ] && ln -sfn /meme/static/$d $R/client/$d; done
chown -R meme:meme $R
# 数据库迁移：按 d1_migrations 记录找出没跑过的，停服务、先备份、逐个在事务里执行
DB=/meme/data/db/meme-hall.sqlite
pending=$(for f in $(ls $R/migrations | sort); do [ "$(sqlite3 $DB "SELECT 1 FROM d1_migrations WHERE name='$f'")" = 1 ] || echo $f; done)
if [ -n "$pending" ]; then
  echo "待执行迁移：$pending"
  systemctl stop meme-hall
  sqlite3 $DB ".backup /meme/backups/pre-migrate-${id}.sqlite"
  for f in $pending; do
    { echo ".dbconfig defensive off"; echo "PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;"; cat $R/migrations/$f; echo; echo "INSERT INTO d1_migrations(name) VALUES('$f'); COMMIT; PRAGMA foreign_key_check;"; } | sqlite3 -bail $DB > /tmp/migrate.out || { echo "迁移 $f 失败，已回滚"; cat /tmp/migrate.out; systemctl start meme-hall; exit 1; }
    grep -v "defensive" /tmp/migrate.out > /tmp/migrate.fk || true; [ -s /tmp/migrate.fk ] && { echo "迁移 $f 后外键检查有输出："; head -20 /tmp/migrate.fk; }
    echo "已执行 $f"
  done
  sqlite3 $DB "PRAGMA optimize"; chown meme:meme $DB
fi
ln -sfn $R /meme/app/current.new && mv -T /meme/app/current.new /meme/app/current
systemctl restart meme-hall
for i in $(seq 1 20); do sleep 1; code=$(curl -s -o /dev/null -w '%{http_code}' -H 'X-Forwarded-Proto: https' http://127.0.0.1:8080/api/me || true); [ "$code" = 200 ] && break; done
[ "$code" = 200 ] || { echo "健康检查失败（$code），自动回滚"; prev=$(ls -1 /meme/app/releases | sort | grep -v '^${id}$' | tail -1); [ "$prev" ] && ln -sfn /meme/app/releases/$prev /meme/app/current.new && mv -T /meme/app/current.new /meme/app/current && systemctl restart meme-hall; exit 1; }
cd /meme/app/releases && ls -1 | sort | head -n -5 | xargs -r rm -rf
echo "已发布 ${id}"`)
