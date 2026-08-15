import https from 'https';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

async function download(url, dest) {
  return new Promise((resolve, reject) => {
    const getter = (u) => {
      https.get(u, { headers: { 'User-Agent': 'CS3-Builder' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return getter(res.headers.location);
        }
        if (res.statusCode !== 200) return reject(new Error('Status ' + res.statusCode));
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
      }).on('error', reject);
    };
    getter(url);
  });
}

async function main() {
  const toolchain = path.resolve('D:/projects/cs3/tools/toolchain');
  fs.mkdirSync(toolchain, { recursive: true });
  
  console.log('Downloading JDK 21 (Adoptium Temurin)...');
  const jdkZip = path.join(toolchain, 'jdk.zip');
  await download('https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.2%2B13/OpenJDK21U-jdk_x64_windows_hotspot_21.0.2_13.zip', jdkZip);
  console.log('Extracting JDK 21...');
  execSync(`tar -xf "${jdkZip}" -C "${toolchain}"`);
  fs.unlinkSync(jdkZip);
  console.log('JDK 21 extracted.');

  console.log('Downloading Apache Maven 3.9.6...');
  const mvnZip = path.join(toolchain, 'mvn.zip');
  await download('https://archive.apache.org/dist/maven/maven-3/3.9.6/binaries/apache-maven-3.9.6-bin.zip', mvnZip);
  console.log('Extracting Maven...');
  execSync(`tar -xf "${mvnZip}" -C "${toolchain}"`);
  fs.unlinkSync(mvnZip);
  console.log('Maven extracted.');

  console.log('Toolchain ready in:', toolchain);
}

main().catch(err => {
  console.error('Error fetching toolchain:', err);
  process.exit(1);
});
