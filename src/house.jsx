import React, { useEffect, useMemo, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { CameraControls, Environment, ContactShadows, Html } from '@react-three/drei';

const roomSpecs = [
  { id: 'living', name: 'Living room', x: -2.25, z: 1.0, w: 4.5, d: 4.0, floor: '#bca68f', wall: '#e8dfd2' },
  { id: 'kitchen', name: 'Kitchen', x: 2.25, z: 1.0, w: 4.5, d: 4.0, floor: '#c7c3ba', wall: '#e9e7e1' },
  { id: 'bedroom', name: 'Bedroom', x: -2.25, z: -3.0, w: 4.5, d: 4.0, floor: '#b9a28c', wall: '#e6d9cc' },
  { id: 'bathroom', name: 'Bathroom', x: 2.25, z: -3.0, w: 4.5, d: 4.0, floor: '#aebec0', wall: '#e6eeee' }
];

function Box({ position, size, color, material = {}, onClick, emissive, emissiveIntensity = 0 }) {
  return <mesh position={position} castShadow receiveShadow onClick={onClick}>
    <boxGeometry args={size} />
    <meshStandardMaterial color={color} roughness={material.roughness ?? 0.78} metalness={material.metalness ?? 0.02} emissive={emissive || '#000000'} emissiveIntensity={emissiveIntensity} />
  </mesh>;
}

function Lamp({ position, on, onClick, label }) {
  return <group position={position} onClick={(e) => { e.stopPropagation(); onClick(); }}>
    <mesh position={[0, -0.22, 0]}><cylinderGeometry args={[0.08, 0.08, 0.42, 16]} /><meshStandardMaterial color="#5b5147" /></mesh>
    <mesh position={[0, -0.48, 0]}><cylinderGeometry args={[0.22, 0.28, 0.18, 24]} /><meshStandardMaterial color={on ? '#f7dba0' : '#6c7479'} emissive={on ? '#ffb74d' : '#000000'} emissiveIntensity={on ? 2.8 : 0} /></mesh>
    {on && <pointLight position={[0, -0.5, 0]} color="#ffd39a" intensity={5.5} distance={5.8} decay={1.8} castShadow />}
    <Html distanceFactor={12} position={[0, -0.9, 0]} center style={{ pointerEvents: 'none' }}>
      <span className="world-label">{label}</span>
    </Html>
  </group>;
}

function Plant({ position }) {
  return <group position={position}>
    <mesh position={[0, 0.23, 0]}><cylinderGeometry args={[0.22, 0.17, 0.45, 16]} /><meshStandardMaterial color="#a66e4d" roughness={0.9} /></mesh>
    {[0, 1, 2, 3, 4].map((n) => <mesh key={n} position={[Math.sin(n * 1.25) * 0.16, 0.65 + (n % 2) * 0.1, Math.cos(n * 1.25) * 0.13]} rotation={[0.2, n, 0.6]}><sphereGeometry args={[0.19, 12, 10]} /><meshStandardMaterial color={n % 2 ? '#4f765a' : '#638568'} roughness={0.9} /></mesh>)}
  </group>;
}

function Sofa({ position }) {
  return <group position={position}>
    <Box position={[0, 0.35, 0]} size={[2.1, 0.35, 0.86]} color="#78877f" />
    <Box position={[0, 0.72, -0.34]} size={[2.1, 0.65, 0.22]} color="#89978e" />
    <Box position={[-0.95, 0.57, 0]} size={[0.2, 0.58, 0.9]} color="#89978e" />
    <Box position={[0.95, 0.57, 0]} size={[0.2, 0.58, 0.9]} color="#89978e" />
    {[-0.55, 0.1, 0.62].map((x) => <Box key={x} position={[x, 0.57, -0.15]} size={[0.55, 0.3, 0.12]} color="#b6b9a8" />)}
  </group>;
}

function Room({ room, selected, onSelect, onEnterRoom, interiorMode }) {
  const { x, z, w, d } = room;
  const isLiving = room.id === 'living';
  const isKitchen = room.id === 'kitchen';
  const isBedroom = room.id === 'bedroom';
  const isBathroom = room.id === 'bathroom';
  const wallHeight = interiorMode && selected ? 2.65 : 1.25;
  const wallY = interiorMode && selected ? 1.28 : 0.52;
  const chooseRoom = () => { onSelect(room.id); onEnterRoom?.(room.id); };
  return <group>
    <Box position={[x, -0.13, z]} size={[w, 0.22, d]} color={room.floor} onClick={() => onSelect(room.id)} />
    {/* low cutaway walls keep the room visible from the orbit camera */}
    <Box position={[x, wallY, z - d / 2]} size={[w, wallHeight, 0.12]} color={room.wall} />
    <Box position={[x - w / 2, wallY, z]} size={[0.12, wallHeight, d]} color={room.wall} />
    <Box position={[x + w / 2, wallY, z]} size={[0.12, wallHeight, d]} color={room.wall} />
    <Box position={[x, wallY, z + d / 2]} size={[w, wallHeight, 0.12]} color={room.wall} />
    <Box position={[x, -0.005, z]} size={[w - 0.18, 0.025, d - 0.18]} color={room.floor} onClick={chooseRoom} />
    {selected && <Box position={[x, 0.025, z]} size={[w - 0.25, 0.025, d - 0.25]} color="#7dd3c7" emissive="#40c9b5" emissiveIntensity={0.24} onClick={chooseRoom} />}
    {/* window */}
    <Box position={[x + w / 2 - 0.04, 0.78, z - 0.55]} size={[0.035, 0.65, 1.15]} color="#90c8d7" material={{ metalness: 0.3, roughness: 0.2 }} />
    {isLiving && <>
      <Sofa position={[x - 0.1, 0, z + 0.7]} />
      <Box position={[x + 0.25, 0.25, z - 0.45]} size={[1.35, 0.18, 0.7]} color="#8a6d54" />
      <Box position={[x - 1.55, 0.8, z - 1.7]} size={[0.1, 1.1, 1.6]} color="#3c494d" />
      <Box position={[x - 1.48, 0.82, z - 1.7]} size={[0.025, 0.85, 1.35]} color="#263a43" emissive="#0a2633" emissiveIntensity={0.5} />
      <Plant position={[x + 1.7, 0, z + 1.25]} />
    </>}
    {isKitchen && <>
      <Box position={[x - 0.5, 0.45, z - 1.35]} size={[3.25, 0.7, 0.55]} color="#ddd7cb" />
      <Box position={[x - 0.5, 0.84, z - 1.35]} size={[3.35, 0.1, 0.62]} color="#f4f0e8" />
      {[-1.55, -0.5, 0.55].map((dx) => <Box key={dx} position={[x + dx, 0.45, z - 1.05]} size={[0.02, 0.48, 0.02]} color="#8b8a82" />)}
      <Box position={[x + 0.7, 0.42, z + 0.25]} size={[1.8, 0.8, 1.1]} color="#b9b6ad" />
      <Box position={[x + 0.7, 0.85, z + 0.25]} size={[1.9, 0.08, 1.2]} color="#f3f1eb" />
      <Box position={[x - 1.5, 0.6, z + 1.1]} size={[0.5, 1.05, 0.45]} color="#e7e4de" />
    </>}
    {isBedroom && <>
      <Box position={[x + 0.2, 0.28, z + 0.25]} size={[2.2, 0.38, 2.3]} color="#80654f" />
      <Box position={[x + 0.2, 0.5, z + 0.25]} size={[2.05, 0.22, 2.15]} color="#e4ded4" />
      <Box position={[x - 0.35, 0.65, z - 0.45]} size={[0.7, 0.15, 0.65]} color="#f7f1e7" />
      <Box position={[x + 0.65, 0.65, z - 0.45]} size={[0.7, 0.15, 0.65]} color="#f7f1e7" />
      <Box position={[x + 1.55, 0.45, z - 1.2]} size={[0.65, 0.75, 0.55]} color="#8d765e" />
      <Plant position={[x - 1.7, 0, z + 1.3]} />
    </>}
    {isBathroom && <>
      <Box position={[x + 0.65, 0.22, z - 0.8]} size={[1.55, 0.32, 1.0]} color="#f6f7f3" />
      <Box position={[x + 0.65, 0.4, z - 0.8]} size={[1.45, 0.08, 0.9]} color="#d8e8e9" />
      <Box position={[x - 1.2, 0.35, z + 0.7]} size={[0.75, 0.55, 0.75]} color="#f6f6f2" />
      <Box position={[x - 1.2, 0.68, z + 0.7]} size={[0.65, 0.15, 0.65]} color="#e3eded" />
      <Box position={[x - 0.2, 0.65, z - 1.5]} size={[1.4, 0.75, 0.05]} color="#90c8d7" material={{ roughness: 0.2, metalness: 0.2 }} />
    </>}
  </group>;
}

function DeviceObjects({ devices, toggleDevice, selectedRoom, interiorMode }) {
  const visible = (roomId) => !interiorMode || selectedRoom === roomId;
  return <>
    {visible('living') && <Lamp position={[-3.1, 1.85, 1.2]} on={devices.livingLight} onClick={() => toggleDevice('livingLight')} label="LIVING LIGHT" />}
    {visible('kitchen') && <Lamp position={[1.4, 1.85, 1.25]} on={devices.kitchenLight} onClick={() => toggleDevice('kitchenLight')} label="KITCHEN LIGHT" />}
    {visible('bedroom') && <Lamp position={[-2.4, 1.85, -3.4]} on={devices.bedroomLight} onClick={() => toggleDevice('bedroomLight')} label="BEDROOM LIGHT" />}
    {visible('bathroom') && <Lamp position={[2.8, 1.85, -3.1]} on={devices.bathroomLight} onClick={() => toggleDevice('bathroomLight')} label="BATH LIGHT" />}
  </>;
}

function Scene({ selectedRoom, setSelectedRoom, devices, toggleDevice, interiorMode, setInteriorMode }) {
  const rooms = useMemo(() => roomSpecs, []);
  const cameraControls = useRef(null);
  const activeRoom = rooms.find((room) => room.id === selectedRoom) || rooms[0];
  useEffect(() => {
    if (!cameraControls.current) return;
    if (interiorMode) {
      cameraControls.current.setLookAt(activeRoom.x, 1.58, activeRoom.z + 1.12, activeRoom.x, 1.35, activeRoom.z - 1.1, true);
    } else {
      cameraControls.current.setLookAt(10, 11, 13, 0, 0.1, -0.7, true);
    }
  }, [interiorMode, activeRoom]);
  return <>
    <color attach="background" args={['#10181b']} />
    <fog attach="fog" args={['#10181b', 18, 34]} />
    <ambientLight intensity={0.78} />
    <directionalLight position={[4, 10, 5]} intensity={1.65} castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048} />
    <directionalLight position={[-5, 7, -3]} intensity={0.42} color="#d4e8ff" />
    {rooms.filter((room) => !interiorMode || room.id === selectedRoom).map((room) => <Room key={room.id} room={room} selected={selectedRoom === room.id} onSelect={setSelectedRoom} onEnterRoom={(id) => { setSelectedRoom(id); setInteriorMode(true); }} interiorMode={interiorMode} />)}
    <DeviceObjects devices={devices} toggleDevice={toggleDevice} selectedRoom={selectedRoom} interiorMode={interiorMode} />
    <ContactShadows position={[0, -0.02, 0]} opacity={0.35} scale={17} blur={2.2} far={4} />
    <Environment preset="apartment" />
    <CameraControls ref={cameraControls} makeDefault smoothTime={0.9} minDistance={1.5} maxDistance={19} />
  </>;
}

export default function HouseCanvas(props) {
  return <Canvas shadows camera={{ position: [10, 11, 13], fov: 39 }} dpr={[1, 1.6]}>
    <Scene {...props} />
  </Canvas>;
}
