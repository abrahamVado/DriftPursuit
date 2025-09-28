// viewer/app.js - minimal three.js viewer that connects to ws://localhost:8080/ws
const HUD = document.getElementById('hud');
const WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';

let scene, camera, renderer, planeMesh, cakes = {};
initThree();

let socket = new WebSocket(WS_URL);
socket.addEventListener('open', ()=>{ HUD.innerText = 'Connected to broker'; });
socket.addEventListener('message', (ev)=>{
    try{
        const msg = JSON.parse(ev.data);
        handleMsg(msg);
    }catch(e){ console.warn('bad msg', e); }
});

function handleMsg(msg){
    if(msg.type === 'telemetry'){
        const id = msg.id;
        const p = msg.pos;
        // create mesh if needed
        if(!planeMesh){
            const geom = new THREE.BoxGeometry(12,4,4);
            const mat = new THREE.MeshStandardMaterial({color:0x3366ff});
            planeMesh = new THREE.Mesh(geom, mat);
            scene.add(planeMesh);
        }
        // update position (map sim coords to scene; z up)
        planeMesh.position.set(p[0]/2, p[1]/2, p[2]/50);
        camera.position.set(planeMesh.position.x - 40, planeMesh.position.y + 0, planeMesh.position.z + 20);
        camera.lookAt(planeMesh.position);
    } else if(msg.type === 'cake_drop'){
        // create simple sphere at landing_pos and remove after a while
        const id = msg.id;
        const lp = msg.landing_pos || msg.pos;
        const geom = new THREE.SphereGeometry(3,12,12);
        const mat = new THREE.MeshStandardMaterial({color:0xffcc66});
        const s = new THREE.Mesh(geom, mat);
        s.position.set(lp[0]/2, lp[1]/2, lp[2]/50);
        scene.add(s);
        cakes[id] = s;
        setTimeout(()=>{ scene.remove(s); delete cakes[id]; }, 8000);
    }
}

function initThree(){
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xeef3ff);
    camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 10000);
    renderer = new THREE.WebGLRenderer({antialias:true});
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    window.addEventListener('resize', onWindowResize);

    // lights
    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
    hemi.position.set(0, 200, 0); scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 0.8); dir.position.set(-100,100,100); scene.add(dir);

    // ground grid
    const grid = new THREE.GridHelper(2000, 40, 0x888888, 0xcccccc);
    grid.rotation.x = Math.PI/2;
    scene.add(grid);

    animate();
}

function onWindowResize(){
    const width = window.innerWidth;
    const height = window.innerHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
}

function animate(){
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
}
